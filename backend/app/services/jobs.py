"""Durable PostgreSQL job queue primitives."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import Job, JobStatus

SUPPORTED_JOB_TYPES = {
    "system.noop",
    "asset.verify",
    "database.import",
    "database.export",
    "notification.email",
}


async def enqueue_job(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    created_by_id: uuid.UUID,
    job_type: str,
    payload: dict[str, Any],
    max_attempts: int,
    idempotency_key: str | None = None,
) -> Job:
    if job_type not in SUPPORTED_JOB_TYPES:
        raise ValueError(f"Unsupported job type: {job_type}")
    if idempotency_key:
        existing = await db.scalar(
            select(Job).where(
                Job.workspace_id == workspace_id,
                Job.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            return existing
    job = Job(
        workspace_id=workspace_id,
        created_by_id=created_by_id,
        type=job_type,
        payload=payload,
        max_attempts=max_attempts,
        idempotency_key=idempotency_key,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def claim_next_job(db: AsyncSession, *, worker_id: str, lease_seconds: int) -> Job | None:
    now = datetime.now(UTC)
    stale_before = now - timedelta(seconds=lease_seconds)
    job = await db.scalar(
        select(Job)
        .where(
            Job.attempts < Job.max_attempts,
            or_(
                (Job.status == JobStatus.queued) & (Job.run_after <= now),
                (Job.status == JobStatus.running) & (Job.locked_at < stale_before),
            ),
        )
        .order_by(Job.run_after, Job.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if job is None:
        return None
    job.status = JobStatus.running
    job.locked_at = now
    job.locked_by = worker_id
    job.attempts += 1
    await db.commit()
    await db.refresh(job)
    return job


async def complete_job(db: AsyncSession, job: Job, result: dict[str, Any] | None = None) -> None:
    job.status = JobStatus.succeeded
    job.result = result or {}
    job.error = None
    job.locked_at = None
    job.locked_by = None
    await db.commit()


async def fail_job(db: AsyncSession, job: Job, error: str) -> None:
    job.error = error[:4000]
    job.locked_at = None
    job.locked_by = None
    if job.attempts >= job.max_attempts:
        job.status = JobStatus.failed
    else:
        job.status = JobStatus.queued
        delay_seconds = min(300, 2 ** max(job.attempts - 1, 0))
        job.run_after = datetime.now(UTC) + timedelta(seconds=delay_seconds)
    await db.commit()
