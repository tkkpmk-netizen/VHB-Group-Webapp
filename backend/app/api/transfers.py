"""Database CSV/XLSX import and export job APIs."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.asset import Asset, AssetStatus
from app.models.data_source import DataSource, DataSourceKind
from app.models.database import Database
from app.models.field import Entity
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.data_source import DataSourceOut
from app.schemas.job import JobOut
from app.schemas.transfer import (
    DatabaseExportCreate,
    DatabaseImportCreate,
    DatabaseImportPreview,
    ImportPreviewColumn,
    TransferJobOut,
)
from app.services.jobs import enqueue_job
from app.services.spreadsheets import _infer_type, read_tabular
from app.services.storage import ObjectStorage, get_object_storage

router = APIRouter(tags=["transfers"])
settings = get_settings()


async def _database(database_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Database:
    database = await db.get(Database, database_id)
    if database is None or database.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Database not found")
    return database


@router.post(
    "/databases/{database_id}/imports",
    response_model=TransferJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def import_database(
    database_id: uuid.UUID,
    payload: DatabaseImportCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransferJobOut:
    await _database(database_id, workspace, db)
    if not payload.name_column.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Select the required Name column before importing",
        )
    asset = await db.get(Asset, payload.asset_id)
    if asset is None or asset.workspace_id != workspace.id or asset.status is not AssetStatus.ready:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ready asset required")

    reused_source = payload.data_source_id is not None
    if reused_source:
        data_source = await db.get(DataSource, payload.data_source_id)
        if data_source is None or data_source.database_id != database_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Data source not found")
    else:
        name = payload.data_source_name or f"Import {datetime.now(UTC):%Y-%m-%d %H:%M}"
        data_source = DataSource(
            database_id=database_id,
            name=name,
            kind=DataSourceKind.imported,
            origin_asset_id=asset.id,
        )
        db.add(data_source)
        await db.flush()

    job = await enqueue_job(
        db,
        workspace_id=workspace.id,
        created_by_id=current_user.id,
        job_type="database.import",
        payload={
            "database_id": str(database_id),
            "asset_id": str(asset.id),
            "format": payload.format,
            "mapping": {key: str(value) for key, value in payload.mapping.items()},
            "field_types": {key: str(value) for key, value in payload.field_types.items()},
            "create_missing_fields": payload.create_missing_fields,
            "data_source_id": str(data_source.id),
            "name_column": payload.name_column,
            "include_rows": payload.include_rows,
            "incoming_duplicate_policy": payload.incoming_duplicate_policy,
            "existing_name_policy": payload.existing_name_policy,
        },
        max_attempts=settings.worker_max_attempts,
    )
    if not reused_source:
        data_source.origin_job_id = job.id
        await db.commit()
        await db.refresh(data_source)
    return TransferJobOut(
        job=JobOut.model_validate(job), data_source=DataSourceOut.model_validate(data_source)
    )


@router.post(
    "/databases/{database_id}/imports/preview",
    response_model=DatabaseImportPreview,
)
async def preview_database_import(
    database_id: uuid.UUID,
    payload: DatabaseImportCreate,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> DatabaseImportPreview:
    """Read a ready upload without writing data, for the mapping/review dialog."""
    database = await _database(database_id, workspace, db)
    asset = await db.get(Asset, payload.asset_id)
    if asset is None or asset.workspace_id != workspace.id or asset.status is not AssetStatus.ready:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Ready asset required")
    headers, records = read_tabular(await storage.get_bytes(asset.object_key), payload.format)
    if not headers:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Spreadsheet has no header row")
    default_name_column = next((h for h in headers if h.casefold() == "name"), headers[0])
    name_column = payload.name_column or default_name_column
    name_index = headers.index(name_column) if name_column in headers else 0
    duplicate_rows: dict[str, list[int]] = {}
    for row_index, row in enumerate(records):
        value = str(row[name_index] if name_index < len(row) else "").strip()
        if value:
            duplicate_rows.setdefault(value, []).append(row_index)
    duplicates = {name: rows for name, rows in duplicate_rows.items() if len(rows) > 1}
    names = {name.casefold() for name in duplicate_rows}
    existing = await db.scalars(select(Entity.name).where(Entity.database_id == database.id))
    existing_matches = sorted(name for name in existing.all() if name.casefold() in names)
    columns = [
        ImportPreviewColumn(
            header=header or f"Column {index + 1}",
            inferred_type=_infer_type(
                [row[index] if index < len(row) else None for row in records]
            ),
            samples=[row[index] if index < len(row) else None for row in records[:5]],
        )
        for index, header in enumerate(headers)
    ]
    return DatabaseImportPreview(
        columns=columns,
        rows=records[:100],
        entity_count=len(records),
        duplicate_names=duplicates,
        existing_name_matches=existing_matches,
    )


@router.post(
    "/databases/{database_id}/exports",
    response_model=TransferJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def export_database(
    database_id: uuid.UUID,
    payload: DatabaseExportCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TransferJobOut:
    await _database(database_id, workspace, db)
    job = await enqueue_job(
        db,
        workspace_id=workspace.id,
        created_by_id=current_user.id,
        job_type="database.export",
        payload={"database_id": str(database_id), "format": payload.format},
        max_attempts=settings.worker_max_attempts,
    )
    return TransferJobOut(job=JobOut.model_validate(job))
