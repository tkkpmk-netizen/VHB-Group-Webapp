"""Workspace resource tree APIs (Space → Folder)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.resource import Folder, Space
from app.models.workspace import Workspace
from app.schemas.resource import (
    FolderCreate,
    FolderOut,
    FolderUpdate,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

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
    db: AsyncSession = Depends(get_db),
) -> Space:
    order = (
        await db.scalar(
            select(func.coalesce(func.max(Space.order), -1)).where(
                Space.workspace_id == workspace.id
            )
        )
    ) or 0
    space = Space(
        workspace_id=workspace.id,
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        order=order + 1,
    )
    db.add(space)
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
