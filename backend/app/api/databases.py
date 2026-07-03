"""Database (Notion-style table) CRUD — scoped to the current workspace."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.field import Field, FieldType
from app.models.permission import DatabaseGrant
from app.models.resource import Folder, Space
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import (
    DatabaseCreate,
    DatabaseGrantOut,
    DatabaseGrantUpsert,
    DatabaseOut,
)
from app.services.authorization import Action, require_database_action, require_workspace_action
from app.services.events import record_event

router = APIRouter(prefix="/databases", tags=["databases"])


@router.get("", response_model=list[DatabaseOut])
async def list_databases(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Database]:
    result = await db.execute(
        select(Database)
        .where(Database.workspace_id == workspace.id)
        .order_by(Database.created_at.asc())
    )
    return list(result.scalars().all())


@router.post("", response_model=DatabaseOut, status_code=status.HTTP_201_CREATED)
async def create_database(
    payload: DatabaseCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Database:
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    if payload.folder_id is not None:
        result = await db.execute(
            select(Folder)
            .join(Space, Space.id == Folder.space_id)
            .where(
                Folder.id == payload.folder_id,
                Space.workspace_id == workspace.id,
            )
        )
        if result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Folder not found",
            )
    database = Database(
        workspace_id=workspace.id,
        folder_id=payload.folder_id,
        name=payload.name,
        icon=payload.icon,
    )
    db.add(database)
    await db.flush()
    # Every database starts with a built-in ID + a default "Name" field.
    db.add(
        Field(
            database_id=database.id,
            name="ID",
            type=FieldType.unique_id,
            options={"prefix": ""},
            order=0,
        )
    )
    db.add(
        Field(
            database_id=database.id,
            name="Name",
            type=FieldType.text,
            options={},
            order=1,
        )
    )
    await db.commit()
    await db.refresh(database)
    return database


@router.delete("/{database_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_database(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Database not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    await db.delete(database)
    await db.commit()


@router.get("/{database_id}/grants", response_model=list[DatabaseGrantOut])
async def list_database_grants(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DatabaseGrant]:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    await require_database_action(
        db,
        database_id=database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    result = await db.execute(select(DatabaseGrant).where(DatabaseGrant.database_id == database_id))
    return list(result.scalars())


@router.put("/{database_id}/grants", response_model=DatabaseGrantOut)
async def upsert_database_grant(
    database_id: uuid.UUID,
    payload: DatabaseGrantUpsert,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DatabaseGrant:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    await require_database_action(
        db,
        database_id=database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == payload.user_id,
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "User is not a workspace member")
    grant = await db.scalar(
        select(DatabaseGrant).where(
            DatabaseGrant.database_id == database_id,
            DatabaseGrant.user_id == payload.user_id,
        )
    )
    if grant is None:
        grant = DatabaseGrant(database_id=database_id, user_id=payload.user_id, role=payload.role)
        db.add(grant)
    else:
        grant.role = payload.role
    record_event(
        db,
        action="database.grant_changed",
        resource_type="database",
        resource_id=str(database_id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"user_id": str(payload.user_id), "role": payload.role.value},
    )
    await db.commit()
    await db.refresh(grant)
    return grant
