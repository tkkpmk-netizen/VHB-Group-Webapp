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
from app.models.permission import ResourceType
from app.models.resource import Folder, Space
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.workspace import DatabaseCreate, DatabaseOut
from app.services.authorization import (
    Action,
    delete_resource_grants,
    require_database_action,
    require_workspace_action,
)
from app.services.drive_file_cleanup import cleanup_drive_files

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
    await delete_resource_grants(
        db,
        workspace_id=workspace.id,
        resource_type=ResourceType.database,
        resource_id=database.id,
    )
    await cleanup_drive_files(db, database_id=database.id)
    await db.delete(database)
    await db.commit()
