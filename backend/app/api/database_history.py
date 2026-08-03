"""Database change history, restore and one-step Undo."""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.database_change import DatabaseChange
from app.models.field import Entity, Field
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.database_change import (
    DatabaseChangeOut,
    DatabaseChangeRestoreResult,
    DatabaseFieldChangeOut,
)
from app.services.authorization import Action, require_database_action
from app.services.database_history import (
    latest_undoable_change,
    restore_database_change,
    snapshot_entity,
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
    entity_id: uuid.UUID | None = Query(default=None),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DatabaseChangeOut]:
    await _database(
        database_id,
        workspace,
        current_user,
        db,
        action=Action.read,
    )
    conditions = [DatabaseChange.database_id == database_id]
    if entity_id is not None:
        entity_key = str(entity_id)
        conditions.append(
            or_(
                DatabaseChange.created["entities"].contains([entity_key]),
                DatabaseChange.before["entities"].contains([{"id": entity_key}]),
            )
        )
    changes = list(
        (
            await db.scalars(
                select(DatabaseChange)
                .where(*conditions)
                .order_by(
                    DatabaseChange.created_at.desc(),
                    DatabaseChange.id.desc(),
                )
                .limit(limit)
            )
        ).all()
    )
    actor_ids = {change.actor_id for change in changes if change.actor_id is not None}
    actors = {
        actor.id: actor
        for actor in (
            await db.scalars(select(User).where(User.id.in_(actor_ids)))
        ).all()
    }
    if entity_id is None:
        return [
            DatabaseChangeOut.model_validate(change).model_copy(
                update={
                    "actor_name": actors[change.actor_id].full_name
                    if change.actor_id in actors
                    else None,
                    "actor_email": actors[change.actor_id].email
                    if change.actor_id in actors
                    else None,
                }
            )
            for change in changes
        ]

    fields = list(
        (
            await db.scalars(
                select(Field)
                .where(Field.database_id == database_id)
                .order_by(Field.order, Field.created_at)
            )
        ).all()
    )
    current_entity = await db.scalar(
        select(Entity).where(
            Entity.id == entity_id,
            Entity.database_id == database_id,
        )
    )
    current_state = snapshot_entity(current_entity) if current_entity is not None else None
    entity_key = str(entity_id)
    result: list[DatabaseChangeOut] = []
    for change in changes:
        before_state = next(
            (
                snapshot
                for snapshot in change.before.get("entities", [])
                if snapshot.get("id") == entity_key
            ),
            None,
        )
        field_changes = _field_changes(fields, before_state, current_state)
        actor = actors.get(change.actor_id) if change.actor_id is not None else None
        result.append(
            DatabaseChangeOut.model_validate(change).model_copy(
                update={
                    "actor_name": actor.full_name if actor else None,
                    "actor_email": actor.email if actor else None,
                    "field_changes": field_changes,
                }
            )
        )
        current_state = before_state
    return result


def _snapshot_field_value(snapshot: dict[str, Any] | None, field: Field) -> Any:
    if snapshot is None:
        return None
    system_key = (field.options or {}).get("system_key")
    if field.type.value == "unique_id":
        return snapshot.get("uid")
    if system_key == "name" or field.type.value == "name":
        return snapshot.get("name")
    return (snapshot.get("data") or {}).get(str(field.id))


def _field_changes(
    fields: list[Field],
    before_state: dict[str, Any] | None,
    after_state: dict[str, Any] | None,
) -> list[DatabaseFieldChangeOut]:
    result: list[DatabaseFieldChangeOut] = []
    for field in fields:
        before_value = _snapshot_field_value(before_state, field)
        after_value = _snapshot_field_value(after_state, field)
        if before_value == after_value:
            continue
        result.append(
            DatabaseFieldChangeOut(
                field_id=field.id,
                field_name=field.name,
                before_value=before_value,
                after_value=after_value,
            )
        )
    return result


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
