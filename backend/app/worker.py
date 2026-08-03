"""Durable job worker entrypoint.

Run with: uv run python -m app.worker
"""

import asyncio
import logging
import socket
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.job import Job
from app.services.events import publish_next_outbox_event
from app.services.job_handlers import JobExecutionContext, get_job_handler
from app.services.jobs import (
    JobCancelledError,
    cancel_job_execution,
    claim_next_job,
    complete_job,
    fail_job,
    structured_job_error,
)
from app.services.storage import ObjectStorage, get_object_storage

settings = get_settings()
logger = logging.getLogger("vhb.jobs")


async def execute_job(
    db: AsyncSession,
    job: Job,
    storage: ObjectStorage,
) -> dict[str, Any]:
    context = JobExecutionContext(db=db, job=job, storage=storage)
    await context.raise_if_cancelled()
    handler = get_job_handler(job.type)
    return await handler(context)


async def run_once(
    *,
    worker_id: str,
    storage: ObjectStorage | None = None,
) -> bool:
    async with SessionLocal() as db:
        job = await claim_next_job(
            db,
            worker_id=worker_id,
            lease_seconds=settings.worker_lease_seconds,
        )
        if job is None:
            return False
        context = dict(job.operation_context)
        logger.info(
            "job_claimed",
            extra={
                "job_id": str(job.id),
                "job_type": job.type,
                "workspace_id": str(job.workspace_id),
                "attempt": job.attempts,
                "request_id": context.get("request_id"),
                "correlation_id": context.get("correlation_id"),
            },
        )
        try:
            result = await execute_job(db, job, storage or get_object_storage())
            await complete_job(db, job, result)
            logger.info(
                "job_succeeded",
                extra={"job_id": str(job.id), "job_type": job.type},
            )
        except JobCancelledError:
            await cancel_job_execution(db, job)
            logger.info(
                "job_cancelled",
                extra={"job_id": str(job.id), "job_type": job.type},
            )
        except Exception as exc:
            error = structured_job_error(exc, job.payload)
            await fail_job(db, job, error)
            logger.warning(
                "job_failed",
                extra={
                    "job_id": str(job.id),
                    "job_type": job.type,
                    "error_code": error["code"],
                    "retryable": error["retryable"],
                },
            )
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
