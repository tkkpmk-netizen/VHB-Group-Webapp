"""Workspace-scoped durable job APIs."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.job import Job, JobStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.asset import AssetDownloadOut
from app.schemas.job import JobCreate, JobOut
from app.services.events import record_event
from app.services.jobs import (
    enqueue_job,
    operation_context_from_headers,
    request_job_cancellation,
)
from app.services.storage import ObjectStorage, get_object_storage

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
    parent_job_id: uuid.UUID | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Job]:
    query = select(Job).where(Job.workspace_id == workspace.id)
    if job_status is not None:
        query = query.where(Job.status == job_status)
    if parent_job_id is not None:
        query = query.where(Job.parent_job_id == parent_job_id)
    result = await db.execute(query.order_by(Job.created_at.desc()).offset(offset).limit(limit))
    return list(result.scalars())


@router.post("", response_model=JobOut, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    payload: JobCreate,
    request: Request,
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
            parent_job_id=payload.parent_job_id,
            chunk_key=payload.chunk_key,
            priority=payload.priority,
            progress_total=payload.progress_total,
            operation_context=operation_context_from_headers(
                actor_id=current_user.id,
                request_id=getattr(request.state, "request_id", None),
                command_id=request.headers.get("X-Command-ID"),
                correlation_id=request.headers.get("X-Correlation-ID"),
                causation_id=request.headers.get("X-Causation-ID"),
            ),
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


@router.get("/{job_id}/children", response_model=list[JobOut])
async def list_job_children(
    job_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Job]:
    await _scoped_job(job_id, workspace, db)
    result = await db.execute(
        select(Job)
        .where(
            Job.workspace_id == workspace.id,
            Job.parent_job_id == job_id,
        )
        .order_by(Job.created_at, Job.chunk_key)
    )
    return list(result.scalars())


@router.get("/{job_id}/artifacts/{artifact_index}/download", response_model=AssetDownloadOut)
async def download_job_artifact(
    job_id: uuid.UUID,
    artifact_index: int,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> AssetDownloadOut:
    job = await _scoped_job(job_id, workspace, db)
    artifacts = (job.result or {}).get("artifacts", [])
    if not isinstance(artifacts, list) or artifact_index < 0 or artifact_index >= len(artifacts):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job artifact not found")
    artifact = artifacts[artifact_index]
    if not isinstance(artifact, dict) or not isinstance(artifact.get("object_key"), str):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job artifact not found")
    object_key = artifact["object_key"]
    filename = object_key.rsplit("/", 1)[-1]
    url = await storage.presign_download(
        object_key,
        filename=filename,
        expires_seconds=settings.storage_presign_ttl_seconds,
    )
    return AssetDownloadOut(download_url=url, expires_in=settings.storage_presign_ttl_seconds)


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
    job.error_details = None
    job.result = None
    job.cancellation_requested_at = None
    job.completed_at = None
    job.locked_at = None
    job.locked_by = None
    job.run_after = datetime.now(UTC)
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_job(
    job_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Job:
    job = await _scoped_job(job_id, workspace, db)
    try:
        await request_job_cancellation(db, job)
    except ValueError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    record_event(
        db,
        action="job.cancellation_requested",
        resource_type="job",
        resource_id=str(job.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"status": job.status.value},
    )
    await db.commit()
    await db.refresh(job)
    return job
