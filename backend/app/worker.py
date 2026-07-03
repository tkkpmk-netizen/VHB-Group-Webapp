"""Durable job worker entrypoint.

Run with: uv run python -m app.worker
"""

import asyncio
import socket
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.asset import Asset, AssetStatus
from app.models.database import Database
from app.models.field import Field, Row
from app.models.job import Job
from app.services.events import publish_next_outbox_event
from app.services.jobs import claim_next_job, complete_job, fail_job
from app.services.spreadsheets import export_rows, import_rows, read_tabular
from app.services.storage import ObjectStorage, get_object_storage

settings = get_settings()


async def execute_job(db: AsyncSession, job: Job, storage: ObjectStorage) -> dict[str, Any]:
    if job.type == "system.noop":
        return {"ok": True, "echo": job.payload}
    if job.type == "asset.verify":
        raw_asset_id = job.payload.get("asset_id")
        try:
            asset_id = uuid.UUID(str(raw_asset_id))
        except (TypeError, ValueError) as exc:
            raise ValueError("asset.verify requires a valid asset_id") from exc
        asset = await db.get(Asset, asset_id)
        if asset is None or asset.workspace_id != job.workspace_id:
            raise ValueError("Asset not found")
        actual_size = await storage.object_size(asset.object_key)
        if actual_size != asset.size_bytes:
            asset.status = AssetStatus.failed
            await db.commit()
            raise ValueError(f"Size mismatch: expected {asset.size_bytes}, received {actual_size}")
        asset.status = AssetStatus.ready
        await db.commit()
        return {"asset_id": str(asset.id), "size_bytes": actual_size}
    if job.type == "database.import":
        database = await db.get(Database, uuid.UUID(str(job.payload["database_id"])))
        asset = await db.get(Asset, uuid.UUID(str(job.payload["asset_id"])))
        if (
            database is None
            or asset is None
            or database.workspace_id != job.workspace_id
            or asset.workspace_id != job.workspace_id
        ):
            raise ValueError("Database or import asset not found")
        headers, records = read_tabular(
            await storage.get_bytes(asset.object_key), str(job.payload["format"])
        )
        if not headers:
            raise ValueError("Spreadsheet has no header row")
        return await import_rows(
            db,
            database=database,
            headers=headers,
            records=records,
            mapping=dict(job.payload.get("mapping") or {}),
            create_missing_fields=bool(job.payload.get("create_missing_fields", True)),
        )
    if job.type == "database.export":
        database = await db.get(Database, uuid.UUID(str(job.payload["database_id"])))
        if database is None or database.workspace_id != job.workspace_id:
            raise ValueError("Database not found")
        fields = list(
            (
                await db.execute(
                    select(Field).where(Field.database_id == database.id).order_by(Field.order)
                )
            ).scalars()
        )
        rows = list(
            (
                await db.execute(
                    select(Row).where(Row.database_id == database.id).order_by(Row.order, Row.seq)
                )
            ).scalars()
        )
        file_format = str(job.payload["format"])
        data, content_type = export_rows(fields, rows, file_format)
        asset_id = uuid.uuid4()
        filename = f"{database.name}.{file_format}"
        object_key = f"workspaces/{job.workspace_id}/exports/{asset_id}/{filename}"
        await storage.put_bytes(object_key, data, content_type=content_type)
        asset = Asset(
            id=asset_id,
            workspace_id=job.workspace_id,
            created_by_id=job.created_by_id,
            object_key=object_key,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            status=AssetStatus.ready,
        )
        db.add(asset)
        await db.commit()
        return {"asset_id": str(asset.id), "rows_exported": len(rows)}
    raise ValueError(f"No handler for job type: {job.type}")


async def run_once(
    *,
    worker_id: str,
    storage: ObjectStorage | None = None,
) -> bool:
    async with SessionLocal() as db:
        job = await claim_next_job(
            db, worker_id=worker_id, lease_seconds=settings.worker_lease_seconds
        )
        if job is None:
            return False
        try:
            result = await execute_job(db, job, storage or get_object_storage())
            await complete_job(db, job, result)
        except Exception as exc:
            await fail_job(db, job, f"{type(exc).__name__}: {exc}")
        return True


async def publish_outbox_once() -> bool:
    async with SessionLocal() as db:
        return await publish_next_outbox_event(db) is not None


async def main() -> None:
    worker_id = f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"
    while True:
        worked = await run_once(worker_id=worker_id)
        published = await publish_outbox_once()
        if not worked and not published:
            await asyncio.sleep(settings.worker_poll_seconds)


if __name__ == "__main__":
    asyncio.run(main())
