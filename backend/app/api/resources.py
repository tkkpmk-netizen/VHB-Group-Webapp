"""Workspace resource tree APIs (Space → Folder)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.layout import Layout
from app.models.resource import Folder, Space, SpaceDatabasePlacement
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.resource import (
    FolderCreate,
    FolderOut,
    FolderUpdate,
    SpaceCreate,
    SpaceDatabaseCreate,
    SpaceDatabaseOut,
    SpaceDatabaseReorder,
    SpaceDatabaseUpdate,
    SpaceOut,
    SpaceUpdate,
)
from app.services.authorization import Action, require_database_action, require_workspace_action
from app.services.layouts import ensure_placement_layouts
from app.services.spaces import create_space_with_dashboard

router = APIRouter(tags=["resources"])


async def _scoped_space(space_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Space:
    space = await db.get(Space, space_id)
    if space is None or space.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Space not found")
    return space


async def _scoped_folder(folder_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Folder:
    result = await db.execute(
        select(Folder)
        .join(Space, Space.id == Folder.space_id)
        .where(Folder.id == folder_id, Space.workspace_id == workspace.id)
    )
    folder = result.scalar_one_or_none()
    if folder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    return folder


async def _scoped_placement(
    placement_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> SpaceDatabasePlacement:
    result = await db.execute(
        select(SpaceDatabasePlacement)
        .join(Space, Space.id == SpaceDatabasePlacement.space_id)
        .where(
            SpaceDatabasePlacement.id == placement_id,
            Space.workspace_id == workspace.id,
        )
    )
    placement = result.scalar_one_or_none()
    if placement is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database placement not found")
    return placement


async def _validate_placement_targets(
    *,
    space: Space,
    database_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    layout_id: uuid.UUID | None,
    workspace: Workspace,
    db: AsyncSession,
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    if folder_id is not None:
        folder = await _scoped_folder(folder_id, workspace, db)
        if folder.space_id != space.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Folder must belong to the placement Space",
            )
    if layout_id is not None:
        layout = await db.get(Layout, layout_id)
        if layout is None or layout.database_id != database.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Layout must belong to the placed Database",
            )
    return database


async def _validate_parent(
    *,
    space_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    folder_id: uuid.UUID | None,
    workspace: Workspace,
    db: AsyncSession,
) -> None:
    if parent_id is None:
        return
    if parent_id == folder_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Folder cannot parent itself")
    parent = await _scoped_folder(parent_id, workspace, db)
    if parent.space_id != space_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Parent folder must belong to the same space",
        )
    # Walk ancestors to reject cycles when moving an existing folder.
    seen: set[uuid.UUID] = set()
    current: Folder | None = parent
    while current is not None and current.parent_id is not None:
        if current.id in seen or current.parent_id == folder_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Folder hierarchy cannot contain a cycle",
            )
        seen.add(current.id)
        current = await db.get(Folder, current.parent_id)


@router.get("/spaces", response_model=list[SpaceOut])
async def list_spaces(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Space]:
    result = await db.execute(
        select(Space)
        .where(Space.workspace_id == workspace.id)
        .order_by(Space.order, Space.created_at)
    )
    return list(result.scalars().all())


@router.post("/spaces", response_model=SpaceOut, status_code=status.HTTP_201_CREATED)
async def create_space(
    payload: SpaceCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Space:
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    order = (
        await db.scalar(
            select(func.coalesce(func.max(Space.order), -1)).where(
                Space.workspace_id == workspace.id
            )
        )
    ) or 0
    space = await create_space_with_dashboard(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        order=order + 1,
    )
    await db.commit()
    await db.refresh(space)
    return space


@router.patch("/spaces/{space_id}", response_model=SpaceOut)
async def update_space(
    space_id: uuid.UUID,
    payload: SpaceUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Space:
    space = await _scoped_space(space_id, workspace, db)
    for key in payload.model_fields_set:
        setattr(space, key, getattr(payload, key))
    await db.commit()
    await db.refresh(space)
    return space


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_space(
    space_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    space = await _scoped_space(space_id, workspace, db)
    await db.delete(space)
    await db.commit()


@router.get("/spaces/{space_id}/folders", response_model=list[FolderOut])
async def list_folders(
    space_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Folder]:
    await _scoped_space(space_id, workspace, db)
    result = await db.execute(
        select(Folder).where(Folder.space_id == space_id).order_by(Folder.order, Folder.created_at)
    )
    return list(result.scalars().all())


@router.post(
    "/spaces/{space_id}/folders",
    response_model=FolderOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_folder(
    space_id: uuid.UUID,
    payload: FolderCreate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Folder:
    await _scoped_space(space_id, workspace, db)
    await _validate_parent(
        space_id=space_id,
        parent_id=payload.parent_id,
        folder_id=None,
        workspace=workspace,
        db=db,
    )
    order = (
        await db.scalar(
            select(func.coalesce(func.max(Folder.order), -1)).where(
                Folder.space_id == space_id,
                Folder.parent_id == payload.parent_id,
            )
        )
    ) or 0
    folder = Folder(
        space_id=space_id,
        parent_id=payload.parent_id,
        name=payload.name,
        icon=payload.icon,
        icon_color=payload.icon_color,
        order=order + 1,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


@router.patch("/folders/{folder_id}", response_model=FolderOut)
async def update_folder(
    folder_id: uuid.UUID,
    payload: FolderUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Folder:
    folder = await _scoped_folder(folder_id, workspace, db)
    if "parent_id" in payload.model_fields_set:
        await _validate_parent(
            space_id=folder.space_id,
            parent_id=payload.parent_id,
            folder_id=folder.id,
            workspace=workspace,
            db=db,
        )
    for key in payload.model_fields_set:
        setattr(folder, key, getattr(payload, key))
    await db.commit()
    await db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_folder(
    folder_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    folder = await _scoped_folder(folder_id, workspace, db)
    await db.delete(folder)
    await db.commit()


@router.get("/spaces/{space_id}/databases", response_model=list[SpaceDatabaseOut])
async def list_space_databases(
    space_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[SpaceDatabasePlacement]:
    await _scoped_space(space_id, workspace, db)
    result = await db.execute(
        select(SpaceDatabasePlacement)
        .where(SpaceDatabasePlacement.space_id == space_id)
        .order_by(
            SpaceDatabasePlacement.folder_id.asc(),
            SpaceDatabasePlacement.order,
            SpaceDatabasePlacement.created_at,
        )
    )
    return list(result.scalars().unique().all())


@router.post(
    "/spaces/{space_id}/databases",
    response_model=SpaceDatabaseOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_space_database(
    space_id: uuid.UUID,
    payload: SpaceDatabaseCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SpaceDatabasePlacement:
    space = await _scoped_space(space_id, workspace, db)
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    database = await _validate_placement_targets(
        space=space,
        database_id=payload.database_id,
        folder_id=payload.folder_id,
        layout_id=payload.layout_id,
        workspace=workspace,
        db=db,
    )
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    existing = await db.scalar(
        select(SpaceDatabasePlacement).where(
            SpaceDatabasePlacement.space_id == space.id,
            SpaceDatabasePlacement.database_id == database.id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Database is already placed in this Space",
        )
    order = await db.scalar(
        select(func.coalesce(func.max(SpaceDatabasePlacement.order), -1)).where(
            SpaceDatabasePlacement.space_id == space.id,
            SpaceDatabasePlacement.folder_id == payload.folder_id,
        )
    )
    placement = SpaceDatabasePlacement(
        space_id=space.id,
        database_id=database.id,
        folder_id=payload.folder_id,
        layout_id=payload.layout_id,
        settings=payload.settings,
        order=(order if order is not None else -1) + 1,
    )
    db.add(placement)
    await db.flush()
    await ensure_placement_layouts(db, placement)
    await db.commit()
    await db.refresh(placement)
    return placement


@router.patch("/space-databases/{placement_id}", response_model=SpaceDatabaseOut)
async def update_space_database(
    placement_id: uuid.UUID,
    payload: SpaceDatabaseUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SpaceDatabasePlacement:
    placement = await _scoped_placement(placement_id, workspace, db)
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    space = await _scoped_space(placement.space_id, workspace, db)
    folder_id = (
        payload.folder_id if "folder_id" in payload.model_fields_set else placement.folder_id
    )
    layout_id = (
        payload.layout_id if "layout_id" in payload.model_fields_set else placement.layout_id
    )
    database = await _validate_placement_targets(
        space=space,
        database_id=placement.database_id,
        folder_id=folder_id,
        layout_id=layout_id,
        workspace=workspace,
        db=db,
    )
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    for key in payload.model_fields_set:
        value = getattr(payload, key)
        if key == "settings" and value is None:
            continue
        setattr(placement, key, value)
    await db.commit()
    await db.refresh(placement)
    return placement


@router.post("/spaces/{space_id}/databases/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_space_databases(
    space_id: uuid.UUID,
    payload: SpaceDatabaseReorder,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    space = await _scoped_space(space_id, workspace, db)
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    ids = [item.id for item in payload.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Duplicate placement id")
    result = await db.execute(
        select(SpaceDatabasePlacement).where(
            SpaceDatabasePlacement.id.in_(ids),
            SpaceDatabasePlacement.space_id == space.id,
        )
    )
    placements = {placement.id: placement for placement in result.scalars().all()}
    if len(placements) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database placement not found")
    for item in payload.items:
        placement = placements[item.id]
        await _validate_placement_targets(
            space=space,
            database_id=placement.database_id,
            folder_id=item.folder_id,
            layout_id=placement.layout_id,
            workspace=workspace,
            db=db,
        )
        await require_database_action(
            db,
            database_id=placement.database_id,
            workspace_id=workspace.id,
            user_id=current_user.id,
            action=Action.read,
        )
        placement.folder_id = item.folder_id
        placement.order = item.order
    await db.commit()


@router.delete("/space-databases/{placement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_space_database(
    placement_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    placement = await _scoped_placement(placement_id, workspace, db)
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    await require_database_action(
        db,
        database_id=placement.database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    await db.delete(placement)
    await db.commit()
