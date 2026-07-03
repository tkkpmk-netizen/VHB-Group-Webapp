"""Workspace-scoped durable job APIs."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.job import Job, JobStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.job import JobCreate, JobOut
from app.services.jobs import enqueue_job

router = APIRouter(prefix="/jobs", tags=["jobs"])
settings = get_settings()


async def _scoped_job(job_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Job:
    job = await db.get(Job, job_id)
    if job is None or job.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


@router.get("", response_model=list[JobOut])
async def list_jobs(
    job_status: JobStatus | None = Query(default=None, alias="status"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Job]:
    query = select(Job).where(Job.workspace_id == workspace.id)
    if job_status is not None:
        query = query.where(Job.status == job_status)
    result = await db.execute(query.order_by(Job.created_at.desc()).offset(offset).limit(limit))
    return list(result.scalars())


@router.post("", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    payload: JobCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Job:
    try:
        return await enqueue_job(
            db,
            workspace_id=workspace.id,
            created_by_id=current_user.id,
            job_type=payload.type,
            payload=payload.payload,
            max_attempts=payload.max_attempts or settings.worker_max_attempts,
            idempotency_key=payload.idempotency_key,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Job:
    return await _scoped_job(job_id, workspace, db)


@router.post("/{job_id}/retry", response_model=JobOut)
async def retry_job(
    job_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Job:
    job = await _scoped_job(job_id, workspace, db)
    if job.status not in {JobStatus.failed, JobStatus.cancelled}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Job is not retryable")
    job.status = JobStatus.queued
    job.attempts = 0
    job.error = None
    job.run_after = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_job(
    job_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> Job:
    job = await _scoped_job(job_id, workspace, db)
    if job.status not in {JobStatus.queued, JobStatus.running}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Job cannot be cancelled")
    job.status = JobStatus.cancelled
    job.locked_at = None
    job.locked_by = None
    await db.commit()
    await db.refresh(job)
    return job
