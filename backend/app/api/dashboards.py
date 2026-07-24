"""Dashboard designer CRUD and query-bound widget data."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.engine import query_entities
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.dashboard import Dashboard, DashboardWidget
from app.models.database import Database
from app.models.permission import ResourceType
from app.models.resource import Space, SpaceDatabasePlacement
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.dashboard import (
    DashboardCreate,
    DashboardOut,
    DashboardUpdate,
    WidgetCreate,
    WidgetDataOut,
    WidgetOut,
    WidgetUpdate,
)
from app.schemas.engine import EntityQuery
from app.services.authorization import (
    Action,
    delete_resource_grants,
    require_database_action,
    require_resource_action,
)
from app.services.events import record_event

router = APIRouter(tags=["dashboards"])


async def _scoped_dashboard(
    dashboard_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Dashboard:
    dashboard = await db.get(Dashboard, dashboard_id)
    if dashboard is None or dashboard.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dashboard not found")
    return dashboard


async def _scoped_widget(
    widget_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> tuple[DashboardWidget, Dashboard]:
    widget = await db.get(DashboardWidget, widget_id)
    if widget is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Widget not found")
    dashboard = await _scoped_dashboard(widget.dashboard_id, workspace, db)
    return widget, dashboard


@router.get("/dashboards", response_model=list[DashboardOut])
async def list_dashboards(
    space_id: uuid.UUID | None = Query(default=None),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Dashboard]:
    query = select(Dashboard).where(Dashboard.workspace_id == workspace.id)
    if space_id is not None:
        space = await db.get(Space, space_id)
        if space is None or space.workspace_id != workspace.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Space not found")
        query = query.where(Dashboard.space_id == space_id)
    result = await db.execute(
        query.order_by(Dashboard.is_default.desc(), Dashboard.updated_at.desc())
    )
    return list(result.scalars())


@router.post(
    "/dashboards",
    response_model=DashboardOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_dashboard(
    payload: DashboardCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dashboard:
    space = await db.get(Space, payload.space_id)
    if space is None or space.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Space not found")
    has_dashboard = bool(
        await db.scalar(
            select(func.count(Dashboard.id)).where(Dashboard.space_id == space.id)
        )
    )
    make_default = payload.is_default or not has_dashboard
    if make_default:
        await db.execute(
            update(Dashboard).where(Dashboard.space_id == space.id).values(is_default=False)
        )
    dashboard = Dashboard(
        workspace_id=workspace.id,
        space_id=space.id,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
        name=payload.name,
        description=payload.description,
        is_default=make_default,
    )
    db.add(dashboard)
    await db.flush()
    record_event(
        db,
        action="dashboard.created",
        resource_type="dashboard",
        resource_id=str(dashboard.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
    )
    await db.commit()
    await db.refresh(dashboard)
    return dashboard


@router.get("/spaces/{space_id}/dashboard", response_model=DashboardOut)
async def get_space_default_dashboard(
    space_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Dashboard:
    space = await db.get(Space, space_id)
    if space is None or space.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Space not found")
    dashboard = await db.scalar(
        select(Dashboard).where(
            Dashboard.space_id == space.id,
            Dashboard.is_default.is_(True),
        )
    )
    if dashboard is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Default dashboard not found")
    return dashboard


@router.get("/dashboards/{dashboard_id}", response_model=DashboardOut)
async def get_dashboard(
    dashboard_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Dashboard:
    return await _scoped_dashboard(dashboard_id, workspace, db)


@router.patch("/dashboards/{dashboard_id}", response_model=DashboardOut)
async def update_dashboard(
    dashboard_id: uuid.UUID,
    payload: DashboardUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Dashboard:
    dashboard = await _scoped_dashboard(dashboard_id, workspace, db)
    if payload.is_default is False and dashboard.is_default:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "A Space must always have a default dashboard",
        )
    if payload.is_default is True and not dashboard.is_default:
        await db.execute(
            update(Dashboard)
            .where(Dashboard.space_id == dashboard.space_id, Dashboard.id != dashboard.id)
            .values(is_default=False)
        )
    for key in payload.model_fields_set:
        value = getattr(payload, key)
        if key == "is_default" and value is None:
            continue
        setattr(dashboard, key, value)
    dashboard.updated_by_id = current_user.id
    await db.commit()
    await db.refresh(dashboard)
    return dashboard


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    dashboard = await _scoped_dashboard(dashboard_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.dashboard,
        resource_id=dashboard.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    if dashboard.is_default:
        replacement = await db.scalar(
            select(Dashboard)
            .where(Dashboard.space_id == dashboard.space_id, Dashboard.id != dashboard.id)
            .order_by(Dashboard.created_at)
        )
        if replacement is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The only dashboard in a Space cannot be deleted",
            )
        dashboard.is_default = False
        await db.flush()
        replacement.is_default = True
    await delete_resource_grants(
        db,
        workspace_id=workspace.id,
        resource_type=ResourceType.dashboard,
        resource_id=dashboard.id,
    )
    await db.delete(dashboard)
    await db.commit()


@router.get("/dashboards/{dashboard_id}/widgets", response_model=list[WidgetOut])
async def list_widgets(
    dashboard_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[DashboardWidget]:
    await _scoped_dashboard(dashboard_id, workspace, db)
    result = await db.execute(
        select(DashboardWidget)
        .where(DashboardWidget.dashboard_id == dashboard_id)
        .order_by(DashboardWidget.order, DashboardWidget.created_at)
    )
    return list(result.scalars())


@router.post(
    "/dashboards/{dashboard_id}/widgets",
    response_model=WidgetOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_widget(
    dashboard_id: uuid.UUID,
    payload: WidgetCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardWidget:
    dashboard = await _scoped_dashboard(dashboard_id, workspace, db)
    database = await db.get(Database, payload.database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    placement = await db.scalar(
        select(SpaceDatabasePlacement.id).where(
            SpaceDatabasePlacement.space_id == dashboard.space_id,
            SpaceDatabasePlacement.database_id == database.id,
        )
    )
    if placement is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Database must be placed in the Dashboard's Space",
        )
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    order = int(
        await db.scalar(
            select(func.coalesce(func.max(DashboardWidget.order), -1)).where(
                DashboardWidget.dashboard_id == dashboard.id
            )
        )
        or 0
    )
    widget = DashboardWidget(
        dashboard_id=dashboard.id,
        database_id=database.id,
        title=payload.title,
        type=payload.type,
        query=payload.query.model_dump(mode="json", exclude_none=True),
        visualization=payload.visualization,
        order=order + 1,
    )
    dashboard.updated_by_id = current_user.id
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return widget


@router.patch("/dashboard-widgets/{widget_id}", response_model=WidgetOut)
async def update_widget(
    widget_id: uuid.UUID,
    payload: WidgetUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DashboardWidget:
    widget, dashboard = await _scoped_widget(widget_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.dashboard,
        resource_id=dashboard.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    for key in payload.model_fields_set:
        value = getattr(payload, key)
        setattr(
            widget,
            key,
            value.model_dump(mode="json", exclude_none=True)
            if key == "query" and value is not None
            else value,
        )
    dashboard.updated_by_id = current_user.id
    await db.commit()
    await db.refresh(widget)
    return widget


@router.delete("/dashboard-widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget(
    widget_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    widget, dashboard = await _scoped_widget(widget_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.dashboard,
        resource_id=dashboard.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await db.delete(widget)
    await db.commit()


@router.get("/dashboard-widgets/{widget_id}/data", response_model=WidgetDataOut)
async def get_widget_data(
    widget_id: uuid.UUID,
    page_size: int = Query(default=10, ge=1, le=50),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WidgetDataOut:
    widget, dashboard = await _scoped_widget(widget_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=ResourceType.dashboard,
        resource_id=dashboard.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    await require_database_action(
        db,
        database_id=widget.database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    query = EntityQuery.model_validate({**widget.query, "page_size": page_size})
    data = await query_entities(widget.database_id, query, workspace, db)
    return WidgetDataOut(widget_id=widget.id, data=data)
