"""DataSource CRUD — scoped to the caller's workspace via the parent database."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.data_source import DataSource
from app.models.database import Database
from app.models.field import Entity
from app.models.workspace import Workspace
from app.schemas.data_source import DataSourceCreate, DataSourceOut, DataSourceUpdate

router = APIRouter(tags=["data-sources"])


async def _scoped_database(
    database_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    return database


async def _scoped_data_source(
    data_source_id: uuid.UUID, workspace: Workspace, db: AsyncSession
) -> DataSource:
    data_source = await db.get(DataSource, data_source_id)
    if data_source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Data source not found")
    await _scoped_database(data_source.database_id, workspace, db)
    return data_source


@router.get("/databases/{database_id}/data-sources", response_model=list[DataSourceOut])
async def list_data_sources(
    database_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[DataSource]:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(
        select(DataSource)
        .where(DataSource.database_id == database_id)
        .order_by(DataSource.order)
    )
    return list(result.scalars().all())


@router.post(
    "/databases/{database_id}/data-sources",
    response_model=DataSourceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_data_source(
    database_id: uuid.UUID,
    payload: DataSourceCreate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> DataSource:
    await _scoped_database(database_id, workspace, db)
    existing = await db.execute(
        select(DataSource.order).where(DataSource.database_id == database_id)
    )
    order = max(list(existing.scalars().all()), default=-1) + 1
    data_source = DataSource(
        database_id=database_id,
        name=payload.name,
        description=payload.description,
        order=order,
    )
    db.add(data_source)
    await db.commit()
    await db.refresh(data_source)
    return data_source


@router.patch("/data-sources/{data_source_id}", response_model=DataSourceOut)
async def update_data_source(
    data_source_id: uuid.UUID,
    payload: DataSourceUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> DataSource:
    data_source = await _scoped_data_source(data_source_id, workspace, db)
    if payload.name is not None:
        data_source.name = payload.name
    if payload.description is not None:
        data_source.description = payload.description
    if payload.order is not None:
        data_source.order = payload.order
    await db.commit()
    await db.refresh(data_source)
    return data_source


@router.delete("/data-sources/{data_source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_data_source(
    data_source_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> None:
    data_source = await _scoped_data_source(data_source_id, workspace, db)
    if data_source.is_primary:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot delete a database's primary data source"
        )
    count = await db.scalar(
        select(func.count()).select_from(Entity).where(Entity.data_source_id == data_source.id)
    )
    if count:
        raise HTTPException(status.HTTP_409_CONFLICT, "Data source still has entities")
    await db.delete(data_source)
    await db.commit()
