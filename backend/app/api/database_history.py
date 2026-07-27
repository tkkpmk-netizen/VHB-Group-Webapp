"""Database change history, restore and one-step Undo."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.database_change import DatabaseChange
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.database_change import DatabaseChangeOut, DatabaseChangeRestoreResult
from app.services.authorization import Action, require_database_action
from app.services.database_history import (
    latest_undoable_change,
    restore_database_change,
)

router = APIRouter(tags=["database-history"])


async def _database(
    database_id: uuid.UUID,
    workspace: Workspace,
    current_user: User,
    db: AsyncSession,
    *,
    action: Action,
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=action,
    )
    return database


@router.get(
    "/databases/{database_id}/history",
    response_model=list[DatabaseChangeOut],
)
async def list_database_history(
    database_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DatabaseChange]:
    await _database(
        database_id,
        workspace,
        current_user,
        db,
        action=Action.read,
    )
    return list(
        (
            await db.scalars(
                select(DatabaseChange)
                .where(DatabaseChange.database_id == database_id)
                .order_by(
                    DatabaseChange.created_at.desc(),
                    DatabaseChange.id.desc(),
                )
                .limit(limit)
            )
        ).all()
    )


async def _restore(
    database_id: uuid.UUID,
    change: DatabaseChange | None,
    workspace: Workspace,
    current_user: User,
    db: AsyncSession,
) -> DatabaseChangeRestoreResult:
    await _database(
        database_id,
        workspace,
        current_user,
        db,
        action=Action.write,
    )
    if change is None or change.database_id != database_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Undoable change not found")
    try:
        restored, affected = await restore_database_change(
            db, change=change, actor_id=current_user.id
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await db.commit()
    await db.refresh(change)
    return DatabaseChangeRestoreResult(
        restored_change=DatabaseChangeOut.model_validate(change),
        restored=restored,
        affected_ids=affected,
    )


@router.post(
    "/databases/{database_id}/history/{change_id}/restore",
    response_model=DatabaseChangeRestoreResult,
)
async def restore_history_item(
    database_id: uuid.UUID,
    change_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DatabaseChangeRestoreResult:
    return await _restore(
        database_id,
        await db.get(DatabaseChange, change_id),
        workspace,
        current_user,
        db,
    )


@router.post(
    "/databases/{database_id}/history/undo",
    response_model=DatabaseChangeRestoreResult,
)
async def undo_database_change(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DatabaseChangeRestoreResult:
    return await _restore(
        database_id,
        await latest_undoable_change(db, database_id),
        workspace,
        current_user,
        db,
    )
