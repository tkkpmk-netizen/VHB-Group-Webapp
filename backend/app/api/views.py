"""Saved-view CRUD — scoped to the caller's workspace via the parent database."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.view import View, ViewType
from app.models.workspace import Workspace
from app.schemas.view import ViewCreate, ViewOut, ViewUpdate

router = APIRouter(tags=["views"])


async def _scoped_database(
    database_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    return database


@router.get("/databases/{database_id}/views", response_model=list[ViewOut])
async def list_views(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[View]:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(
        select(View).where(View.database_id == database_id).order_by(View.order)
    )
    views = list(result.scalars().all())
    # Lazily seed a default Table view (covers databases created before views existed).
    if not views:
        view = View(database_id=database_id, name="Table", type=ViewType.table, order=0)
        db.add(view)
        await db.commit()
        await db.refresh(view)
        views = [view]
    return views


@router.post(
    "/databases/{database_id}/views",
    response_model=ViewOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_view(
    database_id: uuid.UUID,
    payload: ViewCreate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> View:
    await _scoped_database(database_id, workspace, db)
    existing = await db.execute(select(View.order).where(View.database_id == database_id))
    order = max(list(existing.scalars().all()), default=-1) + 1
    view = View(
        database_id=database_id,
        name=payload.name,
        type=payload.type,
        config=payload.config,
        order=order,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return view


async def _scoped_view(view_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> View:
    view = await db.get(View, view_id)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "View not found")
    await _scoped_database(view.database_id, workspace, db)
    return view


@router.patch("/views/{view_id}", response_model=ViewOut)
async def update_view(
    view_id: uuid.UUID,
    payload: ViewUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> View:
    view = await _scoped_view(view_id, workspace, db)
    if payload.name is not None:
        view.name = payload.name
    if payload.type is not None:
        view.type = payload.type
    if payload.config is not None:
        view.config = payload.config
    if payload.order is not None:
        view.order = payload.order
    await db.commit()
    await db.refresh(view)
    return view


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_view(
    view_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    view = await _scoped_view(view_id, workspace, db)
    await db.delete(view)
    await db.commit()
