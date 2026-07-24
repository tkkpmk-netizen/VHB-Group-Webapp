"""Saved-layout CRUD — scoped to the caller's workspace via the parent database."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.layout import Layout
from app.models.resource import Space, SpaceDatabasePlacement
from app.models.view_preset import ViewPreset
from app.models.workspace import Workspace
from app.schemas.layout import LayoutCreate, LayoutOut, LayoutUpdate
from app.services.layouts import ensure_canonical_layouts, ensure_placement_layouts

router = APIRouter(tags=["layouts"])


async def _scoped_database(
    database_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    return database


@router.get("/databases/{database_id}/layouts", response_model=list[LayoutOut])
async def list_layouts(
    database_id: uuid.UUID,
    placement_id: uuid.UUID | None = None,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Layout]:
    await _scoped_database(database_id, workspace, db)
    if placement_id is not None:
        placement = await _scoped_database_placement(
            placement_id, database_id, workspace, db
        )
        layouts, changed = await ensure_placement_layouts(db, placement)
    else:
        layouts, changed = await ensure_canonical_layouts(db, database_id)
    if changed:
        await db.commit()
    return layouts


@router.post(
    "/databases/{database_id}/layouts",
    response_model=LayoutOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_layout(
    database_id: uuid.UUID,
    payload: LayoutCreate,
    placement_id: uuid.UUID | None = None,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Layout:
    await _scoped_database(database_id, workspace, db)
    if placement_id is not None:
        await _scoped_database_placement(placement_id, database_id, workspace, db)
    existing = await db.execute(
        select(Layout.order).where(
            Layout.database_id == database_id,
            Layout.placement_id == placement_id,
        )
    )
    order = max(list(existing.scalars().all()), default=-1) + 1
    layout = Layout(
        database_id=database_id,
        placement_id=placement_id,
        name=payload.name,
        type=payload.type,
        icon=payload.icon,
        icon_color=payload.icon_color,
        config=payload.config,
        order=order,
    )
    db.add(layout)
    await db.commit()
    await db.refresh(layout)
    return layout


async def _scoped_database_placement(
    placement_id: uuid.UUID,
    database_id: uuid.UUID,
    workspace: Workspace,
    db: AsyncSession,
) -> SpaceDatabasePlacement:
    result = await db.execute(
        select(SpaceDatabasePlacement)
        .join(Space, Space.id == SpaceDatabasePlacement.space_id)
        .where(
            SpaceDatabasePlacement.id == placement_id,
            SpaceDatabasePlacement.database_id == database_id,
            Space.workspace_id == workspace.id,
        )
    )
    placement = result.scalar_one_or_none()
    if placement is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database placement not found")
    return placement


async def _scoped_layout(layout_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Layout:
    layout = await db.get(Layout, layout_id)
    if layout is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layout not found")
    await _scoped_database(layout.database_id, workspace, db)
    return layout


@router.patch("/layouts/{layout_id}", response_model=LayoutOut)
async def update_layout(
    layout_id: uuid.UUID,
    payload: LayoutUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Layout:
    layout = await _scoped_layout(layout_id, workspace, db)
    if payload.name is not None:
        layout.name = payload.name
    if payload.type is not None:
        layout.type = payload.type
    if "icon" in payload.model_fields_set:
        layout.icon = payload.icon
    if "icon_color" in payload.model_fields_set:
        layout.icon_color = payload.icon_color
    if payload.config is not None:
        layout.config = payload.config
    if payload.order is not None:
        layout.order = payload.order
    if "active_view_preset_id" in payload.model_fields_set:
        if payload.active_view_preset_id is not None:
            preset = await db.get(ViewPreset, payload.active_view_preset_id)
            if preset is None or preset.layout_id != layout.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "View preset not found")
        layout.active_view_preset_id = payload.active_view_preset_id
    await db.commit()
    await db.refresh(layout)
    return layout


@router.delete("/layouts/{layout_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_layout(
    layout_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    layout = await _scoped_layout(layout_id, workspace, db)
    await db.delete(layout)
    await db.commit()
