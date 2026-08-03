"""Typed job handler registry and built-in handlers."""

import hashlib
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.file_worker.protocol import (
    FileOperation,
    FileWorkerManifest,
    InputDescriptor,
)
from app.models.asset import Asset, AssetStatus
from app.models.database import Database
from app.models.field import Entity, Field
from app.models.job import Job, JobStatus
from app.models.notification import Notification
from app.models.site import SiteDeployment, SiteDeploymentStatus
from app.models.user import User
from app.services.email import send_email
from app.services.file_worker import (
    FileWorkerRejectedError,
    FileWorkerResultError,
    FileWorkerTimeoutError,
    run_isolated_file_worker,
)
from app.services.jobs import (
    JobCancelledError,
    JobExecutionError,
    update_job_progress,
)
from app.services.site_build import build_site_deployment
from app.services.spreadsheets import export_entities, import_entities, read_tabular
from app.services.storage import ObjectStorage


@dataclass
class JobExecutionContext:
    db: AsyncSession
    job: Job
    storage: ObjectStorage

    @property
    def checkpoint(self) -> dict[str, Any]:
        return dict(self.job.checkpoint)

    async def raise_if_cancelled(self) -> None:
        await self.db.refresh(
            self.job,
            attribute_names=["cancellation_requested_at", "status"],
        )
        if (
            self.job.cancellation_requested_at is not None
            or self.job.status is JobStatus.cancelled
        ):
            raise JobCancelledError("Cancellation requested")

    async def progress(
        self,
        *,
        current: int,
        total: int | None = None,
        message: str | None = None,
        checkpoint: dict[str, Any] | None = None,
    ) -> None:
        await update_job_progress(
            self.db,
            self.job,
            current=current,
            total=total,
            message=message,
            checkpoint=checkpoint,
        )


JobHandler = Callable[[JobExecutionContext], Awaitable[dict[str, Any]]]
_HANDLERS: dict[str, JobHandler] = {}


def register_job_handler(job_type: str) -> Callable[[JobHandler], JobHandler]:
    def decorator(handler: JobHandler) -> JobHandler:
        if job_type in _HANDLERS:
            raise RuntimeError(f"Duplicate job handler: {job_type}")
        _HANDLERS[job_type] = handler
        return handler

    return decorator


def has_job_handler(job_type: str) -> bool:
    return job_type in _HANDLERS


def get_job_handler(job_type: str) -> JobHandler:
    try:
        return _HANDLERS[job_type]
    except KeyError as exc:
        raise ValueError(f"No handler for job type: {job_type}") from exc


def registered_job_types() -> frozenset[str]:
    return frozenset(_HANDLERS)


@register_job_handler("system.noop")
async def handle_noop(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    return {"ok": True, "echo": context.job.payload}


@register_job_handler("asset.verify")
async def handle_asset_verify(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    raw_asset_id = context.job.payload.get("asset_id")
    try:
        asset_id = uuid.UUID(str(raw_asset_id))
    except (TypeError, ValueError) as exc:
        raise ValueError("asset.verify requires a valid asset_id") from exc
    asset = await context.db.get(Asset, asset_id)
    if asset is None or asset.workspace_id != context.job.workspace_id:
        raise ValueError("Asset not found")
    actual_size = await context.storage.object_size(asset.object_key)
    await context.raise_if_cancelled()
    if actual_size != asset.size_bytes:
        asset.status = AssetStatus.failed
        await context.db.commit()
        raise ValueError(
            f"Size mismatch: expected {asset.size_bytes}, received {actual_size}"
        )
    asset.status = AssetStatus.ready
    await context.db.commit()
    return {"asset_id": str(asset.id), "size_bytes": actual_size}


@register_job_handler("file.inspect")
async def handle_file_inspect(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    raw_asset_id = context.job.payload.get("asset_id")
    try:
        asset_id = uuid.UUID(str(raw_asset_id))
        operation = FileOperation(
            str(context.job.payload.get("operation", FileOperation.scan.value))
        )
    except (TypeError, ValueError) as exc:
        raise JobExecutionError(
            "FILE_INSPECT_PAYLOAD_INVALID",
            "file.inspect requires a valid asset_id and operation.",
            retryable=False,
        ) from exc
    asset = await context.db.get(Asset, asset_id)
    if asset is None or asset.workspace_id != context.job.workspace_id:
        raise JobExecutionError(
            "FILE_ASSET_NOT_FOUND",
            "File inspection asset was not found.",
            retryable=False,
        )
    data = await context.storage.get_bytes(asset.object_key)
    digest = hashlib.sha256(data).hexdigest()
    manifest = FileWorkerManifest(
        job_id=context.job.id,
        operation=operation,
        input=InputDescriptor(
            path="input.bin",
            filename=asset.filename,
            content_type=asset.content_type,
            size_bytes=len(data),
            sha256=digest,
        ),
    )
    await context.progress(
        current=0,
        total=2,
        message="Isolated inspection started",
        checkpoint={"phase": "staged", "input_sha256": digest},
    )
    try:
        output = await run_isolated_file_worker(
            manifest=manifest,
            input_data=data,
        )
    except FileWorkerRejectedError as exc:
        raise JobExecutionError(
            "FILE_SECURITY_REJECTED",
            "File was rejected by the isolated security policy.",
            retryable=False,
        ) from exc
    except FileWorkerTimeoutError as exc:
        raise JobExecutionError(
            exc.code,
            "Isolated file inspection timed out.",
            retryable=True,
        ) from exc
    except FileWorkerResultError as exc:
        raise JobExecutionError(
            exc.code,
            "Isolated file inspection returned an invalid result.",
            retryable=False,
        ) from exc
    await context.raise_if_cancelled()
    stored_artifacts: list[dict[str, Any]] = []
    for descriptor in output.result.artifacts:
        artifact_data = output.artifacts[descriptor.path]
        object_key = (
            f"workspaces/{context.job.workspace_id}/file-worker/"
            f"{context.job.id}/{descriptor.path}"
        )
        await context.storage.put_bytes(
            object_key,
            artifact_data,
            content_type=descriptor.content_type,
        )
        stored_artifacts.append(
            {
                "object_key": object_key,
                "content_type": descriptor.content_type,
                "size_bytes": descriptor.size_bytes,
                "sha256": descriptor.sha256,
            }
        )
    await context.progress(
        current=2,
        total=2,
        message="Isolated inspection completed",
        checkpoint={
            "phase": "completed",
            "input_sha256": digest,
            "artifact_count": len(stored_artifacts),
        },
    )
    return {
        "input_sha256": digest,
        "security_passed": output.result.security_passed,
        "detected_content_type": output.result.detected_content_type,
        "findings": [
            {"code": item.code, "severity": item.severity.value}
            for item in output.result.findings
        ],
        "tool_versions": output.result.tool_versions,
        "artifacts": stored_artifacts,
    }


@register_job_handler("database.import")
async def handle_database_import(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    job = context.job
    database = await context.db.get(
        Database, uuid.UUID(str(job.payload["database_id"]))
    )
    asset = await context.db.get(Asset, uuid.UUID(str(job.payload["asset_id"])))
    if (
        database is None
        or asset is None
        or database.workspace_id != job.workspace_id
        or asset.workspace_id != job.workspace_id
    ):
        raise ValueError("Database or import asset not found")
    headers, records = read_tabular(
        await context.storage.get_bytes(asset.object_key),
        str(job.payload["format"]),
    )
    if not headers:
        raise ValueError("Spreadsheet has no header row")
    await context.progress(
        current=0,
        total=len(records),
        message="Spreadsheet parsed",
        checkpoint={"phase": "parsed", "records": len(records)},
    )
    await context.raise_if_cancelled()
    result = await import_entities(
        context.db,
        database=database,
        headers=headers,
        records=records,
        mapping=dict(job.payload.get("mapping") or {}),
        field_types=dict(job.payload.get("field_types") or {}),
        skipped_columns=list(job.payload.get("skipped_columns") or []),
        create_missing_fields=bool(job.payload.get("create_missing_fields", True)),
        data_source_id=uuid.UUID(str(job.payload["data_source_id"])),
        created_data_source=bool(job.payload.get("created_data_source", False)),
        actor_id=uuid.UUID(str(job.payload.get("actor_id") or job.created_by_id)),
        name_column=str(job.payload["name_column"]),
        include_rows=job.payload.get("include_rows"),
        incoming_duplicate_policy=str(
            job.payload.get("incoming_duplicate_policy", "suffix")
        ),
        existing_name_policy=str(job.payload.get("existing_name_policy", "suffix")),
    )
    await context.progress(
        current=len(records),
        total=len(records),
        message="Import completed",
        checkpoint={"phase": "completed", "records": len(records)},
    )
    return result


@register_job_handler("database.export")
async def handle_database_export(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    job = context.job
    database = await context.db.get(
        Database, uuid.UUID(str(job.payload["database_id"]))
    )
    if database is None or database.workspace_id != job.workspace_id:
        raise ValueError("Database not found")
    fields = list(
        (
            await context.db.execute(
                select(Field)
                .where(Field.database_id == database.id)
                .order_by(Field.order)
            )
        ).scalars()
    )
    entity_query = select(Entity).where(Entity.database_id == database.id)
    requested_ids = job.payload.get("entity_ids")
    if requested_ids is not None:
        entity_query = entity_query.where(
            Entity.id.in_(
                [uuid.UUID(str(entity_id)) for entity_id in requested_ids]
            )
        )
    entities = list(
        (
            await context.db.execute(
                entity_query.order_by(Entity.order, Entity.seq)
            )
        ).scalars()
    )
    await context.progress(
        current=0,
        total=len(entities),
        message="Preparing export",
        checkpoint={"phase": "queried", "entities": len(entities)},
    )
    await context.raise_if_cancelled()
    file_format = str(job.payload["format"])
    data, content_type = export_entities(fields, entities, file_format)
    asset_id = uuid.uuid4()
    filename = f"{database.name}.{file_format}"
    object_key = (
        f"workspaces/{job.workspace_id}/exports/{asset_id}/{filename}"
    )
    await context.storage.put_bytes(object_key, data, content_type=content_type)
    await context.raise_if_cancelled()
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
    context.db.add(asset)
    await context.db.commit()
    await context.progress(
        current=len(entities),
        total=len(entities),
        message="Export completed",
        checkpoint={"phase": "completed", "asset_id": str(asset.id)},
    )
    return {"asset_id": str(asset.id), "entities_exported": len(entities)}


@register_job_handler("notification.email")
async def handle_notification_email(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    notification = await context.db.get(
        Notification,
        uuid.UUID(str(context.job.payload["notification_id"])),
    )
    if (
        notification is None
        or notification.workspace_id != context.job.workspace_id
    ):
        raise ValueError("Notification not found")
    user = await context.db.get(User, notification.user_id)
    if user is None:
        raise ValueError("Notification user not found")
    await send_email(
        recipient=user.email,
        subject=notification.title,
        body=notification.body,
    )
    await context.raise_if_cancelled()
    notification.emailed_at = datetime.now(UTC)
    await context.db.commit()
    return {"notification_id": str(notification.id), "recipient": user.email}


@register_job_handler("site.build")
async def handle_site_build(context: JobExecutionContext) -> dict[str, Any]:
    await context.raise_if_cancelled()
    deployment = await context.db.get(
        SiteDeployment,
        uuid.UUID(str(context.job.payload["deployment_id"])),
    )
    if (
        deployment is None
        or deployment.workspace_id != context.job.workspace_id
    ):
        raise ValueError("Site deployment not found")
    try:
        result = await build_site_deployment(
            context.db,
            deployment=deployment,
            storage=context.storage,
        )
        await context.raise_if_cancelled()
        return result
    except JobCancelledError:
        raise
    except Exception as exc:
        deployment.status = SiteDeploymentStatus.failed
        deployment.error = f"{type(exc).__name__}: {exc}"[:4000]
        await context.db.commit()
        raise
