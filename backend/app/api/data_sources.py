"""DataSource CRUD — scoped to the caller's workspace via the parent database."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.data_source import DataSource
from app.models.database import Database
from app.models.field import Entity
from app.models.layout import Layout
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.data_source import (
    DataSourceCreate,
    DataSourceMerge,
    DataSourceOut,
    DataSourceReorder,
    DataSourceUpdate,
)
from app.services.database_history import (
    record_database_change,
    snapshot_data_source,
    snapshot_entity,
    snapshot_layout,
)

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
) -> list[DataSourceOut]:
    await _scoped_database(database_id, workspace, db)
    result = await db.execute(
        select(DataSource, func.count(Entity.id))
        .outerjoin(Entity, Entity.data_source_id == DataSource.id)
        .where(DataSource.database_id == database_id)
        .group_by(DataSource.id)
        .order_by(DataSource.order)
    )
    return [
        DataSourceOut.model_validate(source).model_copy(update={"entity_count": int(entity_count)})
        for source, entity_count in result.all()
    ]


@router.post(
    "/databases/{database_id}/data-sources",
    response_model=DataSourceOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_data_source(
    database_id: uuid.UUID,
    payload: DataSourceCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
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
    await db.flush()
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=database_id,
        actor_id=current_user.id,
        action="data_source.created",
        summary=f'Created data source "{data_source.name}"',
        created={"data_sources": [data_source.id]},
    )
    await db.commit()
    await db.refresh(data_source)
    return data_source


@router.patch("/data-sources/{data_source_id}", response_model=DataSourceOut)
async def update_data_source(
    data_source_id: uuid.UUID,
    payload: DataSourceUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DataSource:
    data_source = await _scoped_data_source(data_source_id, workspace, db)
    before = snapshot_data_source(data_source)
    if payload.name is not None:
        data_source.name = payload.name
    if payload.description is not None:
        data_source.description = payload.description
    if payload.order is not None:
        data_source.order = payload.order
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=data_source.database_id,
        actor_id=current_user.id,
        action="data_source.updated",
        summary=f'Updated data source "{data_source.name}"',
        before={"data_sources": [before]},
    )
    await db.commit()
    await db.refresh(data_source)
    return data_source


@router.post(
    "/databases/{database_id}/data-sources/reorder",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reorder_data_sources(
    database_id: uuid.UUID,
    payload: DataSourceReorder,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _scoped_database(database_id, workspace, db)
    sources = {
        source.id: source
        for source in (
            await db.scalars(select(DataSource).where(DataSource.database_id == database_id))
        ).all()
    }
    if len(payload.ids) != len(sources) or set(payload.ids) != set(sources):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Reorder must include every data source exactly once",
        )
    before = [snapshot_data_source(source) for source in sources.values()]
    for order, source_id in enumerate(payload.ids):
        sources[source_id].order = order
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=database_id,
        actor_id=current_user.id,
        action="data_source.reordered",
        summary="Reordered data sources",
        before={"data_sources": before},
    )
    await db.commit()


@router.post(
    "/databases/{database_id}/data-sources/merge",
    response_model=DataSourceOut,
)
async def merge_data_sources(
    database_id: uuid.UUID,
    payload: DataSourceMerge,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DataSourceOut:
    """Move every entity into the destination, then remove the merged sources."""
    await _scoped_database(database_id, workspace, db)
    source_ids = list(dict.fromkeys(payload.source_ids))
    if payload.destination_id in source_ids:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Destination cannot also be a source",
        )

    requested_ids = [*source_ids, payload.destination_id]
    sources = {
        source.id: source
        for source in (
            await db.scalars(
                select(DataSource).where(
                    DataSource.database_id == database_id,
                    DataSource.id.in_(requested_ids),
                )
            )
        ).all()
    }
    if set(requested_ids) != set(sources):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Every source and destination must belong to this database",
        )
    merging = [sources[source_id] for source_id in source_ids]
    if any(source.is_primary for source in merging):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The primary data source can only be the merge destination",
        )

    affected_entities = list(
        (
            await db.scalars(
                select(Entity).where(Entity.data_source_id.in_(source_ids))
            )
        ).all()
    )
    source_snapshots = [snapshot_data_source(source) for source in merging]
    entity_snapshots = [snapshot_entity(entity) for entity in affected_entities]
    affected_layouts = list(
        (
            await db.scalars(
                select(Layout).where(Layout.database_id == database_id)
            )
        ).all()
    )
    affected_layouts = [
        layout
        for layout in affected_layouts
        if str(layout.config.get("dataSourceId") or "") in {str(value) for value in source_ids}
    ]
    layout_snapshots = [snapshot_layout(layout) for layout in affected_layouts]
    await db.execute(
        update(Entity)
        .where(Entity.data_source_id.in_(source_ids))
        .values(data_source_id=payload.destination_id)
    )
    for source in merging:
        await db.delete(source)
    for layout in affected_layouts:
        layout.config = {
            **layout.config,
            "dataSourceId": str(payload.destination_id),
        }
    await db.flush()

    remaining = list(
        (
            await db.scalars(
                select(DataSource)
                .where(DataSource.database_id == database_id)
                .order_by(DataSource.order, DataSource.created_at)
            )
        ).all()
    )
    for order, source in enumerate(remaining):
        source.order = order

    destination = sources[payload.destination_id]
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=database_id,
        actor_id=current_user.id,
        action="data_source.merged",
        summary=(
            f'Merged {len(merging)} data source{"s" if len(merging) != 1 else ""} '
            f'into "{destination.name}"'
        ),
        before={
            "data_sources": source_snapshots,
            "entities": entity_snapshots,
            "layouts": layout_snapshots,
        },
    )
    await db.commit()
    await db.refresh(destination)
    entity_count = int(
        await db.scalar(
            select(func.count())
            .select_from(Entity)
            .where(Entity.data_source_id == destination.id)
        )
        or 0
    )
    return DataSourceOut.model_validate(destination).model_copy(
        update={"entity_count": entity_count}
    )


@router.delete("/data-sources/{data_source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_data_source(
    data_source_id: uuid.UUID,
    transfer_to_id: uuid.UUID | None = None,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    data_source = await _scoped_data_source(data_source_id, workspace, db)
    if data_source.is_primary:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot delete a database's primary data source"
        )
    source_entities = list(
        (await db.scalars(select(Entity).where(Entity.data_source_id == data_source.id))).all()
    )
    entity_snapshots = [snapshot_entity(entity) for entity in source_entities]
    count = len(source_entities)
    if count:
        if transfer_to_id is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Data source still has {count} entities; choose a destination",
            )
        destination = await _scoped_data_source(transfer_to_id, workspace, db)
        if destination.database_id != data_source.database_id or destination.id == data_source.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Destination must be another data source in the same database",
            )
        await db.execute(
            update(Entity)
            .where(Entity.data_source_id == data_source.id)
            .values(data_source_id=destination.id)
        )
    record_database_change(
        db,
        workspace_id=workspace.id,
        database_id=data_source.database_id,
        actor_id=current_user.id,
        action="data_source.deleted",
        summary=f'Deleted data source "{data_source.name}"',
        before={
            "data_sources": [snapshot_data_source(data_source)],
            "entities": entity_snapshots,
        },
    )
    await db.delete(data_source)
    await db.commit()
