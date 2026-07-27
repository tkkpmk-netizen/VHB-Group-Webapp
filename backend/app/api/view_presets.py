"""ViewPreset CRUD — scoped to the caller's workspace via the parent layout."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.layout import Layout
from app.models.user import User
from app.models.view_preset import ViewPreset
from app.models.workspace import Workspace
from app.schemas.view_preset import ViewPresetCreate, ViewPresetOut, ViewPresetUpdate
from app.services.database_history import (
    record_database_change,
    snapshot_layout,
    snapshot_view_preset,
)

router = APIRouter(tags=["view-presets"])


async def _scoped_layout(layout_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Layout:
    layout = await db.get(Layout, layout_id)
    if layout is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layout not found")
    database = await db.get(Database, layout.database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Layout not found")
    return layout


async def _scoped_preset(
    preset_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> ViewPreset:
    preset = await db.get(ViewPreset, preset_id)
    if preset is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "View preset not found")
    await _scoped_layout(preset.layout_id, workspace, db)
    return preset


@router.get("/layouts/{layout_id}/view-presets", response_model=list[ViewPresetOut])
async def list_view_presets(
    layout_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[ViewPreset]:
    await _scoped_layout(layout_id, workspace, db)
    result = await db.execute(
        select(ViewPreset).where(ViewPreset.layout_id == layout_id).order_by(ViewPreset.order)
    )
    return list(result.scalars().all())


@router.post(
    "/layouts/{layout_id}/view-presets",
    response_model=ViewPresetOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_view_preset(
    layout_id: uuid.UUID,
    payload: ViewPresetCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ViewPreset:
    layout = await _scoped_layout(layout_id, workspace, db)
    existing = await db.execute(select(ViewPreset.order).where(ViewPreset.layout_id == layout_id))
    order = max(list(existing.scalars().all()), default=-1) + 1
    preset = ViewPreset(
        layout_id=layout_id,
        name=payload.name,
        filter=payload.filter,
        sorts=payload.sorts,
        group_field_id=payload.group_field_id,
        hide_empty=payload.hide_empty,
        order=order,
    )
    db.add(preset)
    await db.flush()
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=layout.database_id,
        actor_id=current_user.id,
        action="view_preset.created",
        summary=f'Created view preset "{preset.name}"',
        created={"view_presets": [preset.id]},
    )
    await db.commit()
    await db.refresh(preset)
    return preset


@router.patch("/view-presets/{preset_id}", response_model=ViewPresetOut)
async def update_view_preset(
    preset_id: uuid.UUID,
    payload: ViewPresetUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ViewPreset:
    preset = await _scoped_preset(preset_id, workspace, db)
    layout = await _scoped_layout(preset.layout_id, workspace, db)
    before = snapshot_view_preset(preset)
    if payload.name is not None:
        preset.name = payload.name
    if payload.filter is not None:
        preset.filter = payload.filter
    if payload.sorts is not None:
        preset.sorts = payload.sorts
    if "group_field_id" in payload.model_fields_set:
        preset.group_field_id = payload.group_field_id
    if payload.hide_empty is not None:
        preset.hide_empty = payload.hide_empty
    if payload.order is not None:
        preset.order = payload.order
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=layout.database_id,
        actor_id=current_user.id,
        action="view_preset.updated",
        summary=f'Updated view preset "{preset.name}"',
        before={"view_presets": [before]},
    )
    await db.commit()
    await db.refresh(preset)
    return preset


@router.delete("/view-presets/{preset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_view_preset(
    preset_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    preset = await _scoped_preset(preset_id, workspace, db)
    layout = await _scoped_layout(preset.layout_id, workspace, db)
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=layout.database_id,
        actor_id=current_user.id,
        action="view_preset.deleted",
        summary=f'Deleted view preset "{preset.name}"',
        before={
            "layouts": [snapshot_layout(layout)],
            "view_presets": [snapshot_view_preset(preset)],
        },
    )
    await db.delete(preset)
    await db.commit()
