"""Database (Notion-style table) CRUD — scoped to the current workspace."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.data_source import DataSource
from app.models.database import Database
from app.models.favorite import DatabaseFavorite
from app.models.field import Field, FieldType
from app.models.layout import Layout
from app.models.permission import ResourceType
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.workspace import (
    DatabaseCreate,
    DatabaseOut,
    DatabaseReorder,
    DatabaseUpdate,
)
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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Database]:
    result = await db.execute(
        select(Database)
        .where(Database.workspace_id == workspace.id)
        .order_by(Database.order.asc(), Database.created_at.asc())
    )
    databases = list(result.scalars().all())
    favorite_ids = set(
        await db.scalars(
            select(DatabaseFavorite.database_id).where(
                DatabaseFavorite.workspace_id == workspace.id,
                DatabaseFavorite.user_id == current_user.id,
            )
        )
    )
    for database in databases:
        database.is_favorite = database.id in favorite_ids
    return databases


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
    order = await db.scalar(
        select(func.coalesce(func.max(Database.order), -1)).where(
            Database.workspace_id == workspace.id,
        )
    )
    database = Database(
        workspace_id=workspace.id,
        name=payload.name,
        icon=payload.icon,
        icon_color=payload.icon_color,
        description=payload.description,
        order=(order if order is not None else -1) + 1,
    )
    db.add(database)
    await db.flush()
    # Every database starts with a built-in ID + a default "Name" field.
    db.add(
        Field(
            database_id=database.id,
            name="ID",
            type=FieldType.unique_id,
            icon="fingerprint",
            options={"prefix": "", "system_key": "uid", "required": True},
            order=0,
        )
    )
    db.add(
        Field(
            database_id=database.id,
            name="Name",
            type=FieldType.text,
            icon="font",
            options={"system_key": "name", "required": True},
            order=1,
        )
    )
    # Every database starts with a primary data source — the fallback target
    # for entities created without an explicit data_source_id.
    db.add(DataSource(database_id=database.id, name="Primary", is_primary=True, order=0))
    await db.commit()
    await db.refresh(database)
    return database


@router.put("/{database_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def favorite_database(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    existing = await db.scalar(
        select(DatabaseFavorite).where(
            DatabaseFavorite.user_id == current_user.id,
            DatabaseFavorite.database_id == database.id,
        )
    )
    if existing is None:
        db.add(
            DatabaseFavorite(
                workspace_id=workspace.id,
                user_id=current_user.id,
                database_id=database.id,
            )
        )
        await db.commit()


@router.delete("/{database_id}/favorite", status_code=status.HTTP_204_NO_CONTENT)
async def unfavorite_database(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    favorite = await db.scalar(
        select(DatabaseFavorite).where(
            DatabaseFavorite.workspace_id == workspace.id,
            DatabaseFavorite.user_id == current_user.id,
            DatabaseFavorite.database_id == database.id,
        )
    )
    if favorite is not None:
        await db.delete(favorite)
        await db.commit()


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_databases(
    payload: DatabaseReorder,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    ids = [item.id for item in payload.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Duplicate database id")

    result = await db.execute(
        select(Database).where(Database.id.in_(ids), Database.workspace_id == workspace.id)
    )
    databases = {database.id: database for database in result.scalars().all()}
    if len(databases) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")

    for item in payload.items:
        database = databases[item.id]
        await require_database_action(
            db,
            database_id=database.id,
            workspace_id=workspace.id,
            user_id=current_user.id,
            action=Action.write,
        )
        database.order = item.order
    await db.commit()


@router.patch("/{database_id}", response_model=DatabaseOut)
async def update_database(
    database_id: uuid.UUID,
    payload: DatabaseUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Database not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(database, key, value)
    await db.commit()
    await db.refresh(database)
    return database


@router.post(
    "/{database_id}/duplicate",
    response_model=DatabaseOut,
    status_code=status.HTTP_201_CREATED,
)
async def duplicate_database(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Database:
    """Clone a canonical database schema and its canonical layouts, never its entities."""
    source = await db.get(Database, database_id)
    if source is None or source.workspace_id != workspace.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Database not found")
    await require_database_action(
        db,
        database_id=source.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    await require_workspace_action(
        db, workspace_id=workspace.id, user_id=current_user.id, action=Action.write
    )
    highest_order = await db.scalar(
        select(func.coalesce(func.max(Database.order), -1)).where(
            Database.workspace_id == workspace.id
        )
    )
    database = Database(
        workspace_id=workspace.id,
        name=f"{source.name} copy",
        icon=source.icon,
        icon_color=source.icon_color,
        description=source.description,
        order=(highest_order if highest_order is not None else -1) + 1,
    )
    db.add(database)
    await db.flush()
    source_fields = list(
        (
            await db.scalars(
                select(Field).where(Field.database_id == source.id).order_by(Field.order)
            )
        ).all()
    )
    for field in source_fields:
        db.add(
            Field(
                database_id=database.id,
                name=field.name,
                icon=field.icon,
                icon_color=field.icon_color,
                type=field.type,
                options=dict(field.options or {}),
                order=field.order,
            )
        )
    db.add(DataSource(database_id=database.id, name="Primary", is_primary=True, order=0))
    source_layouts = list(
        (await db.scalars(
            select(Layout)
            .where(Layout.database_id == source.id, Layout.placement_id.is_(None))
            .order_by(Layout.order)
        )).all()
    )
    for layout in source_layouts:
        db.add(
            Layout(
                database_id=database.id,
                name=layout.name,
                icon=layout.icon,
                icon_color=layout.icon_color,
                type=layout.type,
                config=dict(layout.config or {}),
                order=layout.order,
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
