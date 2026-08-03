"""Durable PostgreSQL job queue and execution-state primitives."""

import hashlib
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.problems import ProblemDetailsError
from app.models.job import Job, JobStatus
from app.schemas.job import OperationContext
from app.services.observability import (
    record_job_duration,
    record_job_event,
    record_job_failure,
    record_job_progress,
    record_job_queue_age,
)

_SENSITIVE_KEY = re.compile(
    r"(password|passwd|token|secret|authorization|api[_-]?key|credential)",
    re.IGNORECASE,
)
_SENSITIVE_TEXT = re.compile(
    r"(?i)\b(password|passwd|token|secret|authorization|api[_-]?key)"
    r"\s*[:=]\s*([^\s,;]+)"
)


class JobCancelledError(Exception):
    """Raised by a cooperative handler after cancellation is requested."""


class JobExecutionError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}


def build_operation_context(
    *,
    actor_id: uuid.UUID,
    request_id: str | None = None,
    command_id: str | None = None,
    correlation_id: str | None = None,
    causation_id: str | None = None,
) -> OperationContext:
    generated_command = command_id or str(uuid.uuid4())
    return OperationContext(
        request_id=(request_id or generated_command)[:200],
        command_id=generated_command[:200],
        correlation_id=(correlation_id or generated_command)[:200],
        causation_id=causation_id[:200] if causation_id else None,
        actor_id=actor_id,
    )


def operation_context_from_headers(
    *,
    actor_id: uuid.UUID,
    request_id: str | None,
    command_id: str | None,
    correlation_id: str | None,
    causation_id: str | None,
) -> OperationContext:
    return build_operation_context(
        actor_id=actor_id,
        request_id=request_id,
        command_id=command_id,
        correlation_id=correlation_id,
        causation_id=causation_id,
    )


def _request_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _idempotency_lock_key(workspace_id: uuid.UUID, key: str) -> int:
    digest = hashlib.sha256(f"job:{workspace_id}:{key}".encode()).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def _sensitive_values(value: object, *, key: str | None = None) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            if _SENSITIVE_KEY.search(str(child_key)):
                if isinstance(child_value, (str, int, float)):
                    found.add(str(child_value))
            found.update(_sensitive_values(child_value, key=str(child_key)))
    elif isinstance(value, list):
        for child in value:
            found.update(_sensitive_values(child, key=key))
    elif key and _SENSITIVE_KEY.search(key) and isinstance(value, (str, int, float)):
        found.add(str(value))
    return {item for item in found if item}


def redact_job_message(message: str, payload: dict[str, Any]) -> str:
    redacted = _SENSITIVE_TEXT.sub(lambda match: f"{match.group(1)}=[REDACTED]", message)
    for sensitive in sorted(_sensitive_values(payload), key=len, reverse=True):
        redacted = redacted.replace(sensitive, "[REDACTED]")
    return redacted[:4000]


def structured_job_error(exc: Exception, payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(exc, JobExecutionError):
        code = exc.code
        retryable = exc.retryable
        details = exc.details
    else:
        code = re.sub(r"(?<!^)(?=[A-Z])", "_", type(exc).__name__).upper()
        retryable = not isinstance(exc, (KeyError, TypeError, ValueError))
        details = {}
    return {
        "code": code[:100],
        "kind": type(exc).__name__[:100],
        "message": redact_job_message(str(exc), payload),
        "retryable": retryable,
        "details": details,
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
    parent_job_id: uuid.UUID | None = None,
    chunk_key: str | None = None,
    priority: int = 0,
    progress_total: int | None = None,
    operation_context: OperationContext | None = None,
) -> Job:
    from app.services.job_handlers import has_job_handler

    if not has_job_handler(job_type):
        raise ValueError(f"Unsupported job type: {job_type}")
    if not -10 <= priority <= 10:
        raise ValueError("Job priority must be between -10 and 10")
    if (parent_job_id is None) != (chunk_key is None):
        raise ValueError("parent_job_id and chunk_key must be provided together")

    parent: Job | None = None
    if parent_job_id is not None:
        parent = await db.get(Job, parent_job_id)
        if parent is None or parent.workspace_id != workspace_id:
            raise ValueError("Parent job not found")
        parent_context = OperationContext.model_validate(parent.operation_context)
        operation_context = build_operation_context(
            actor_id=created_by_id,
            request_id=parent_context.request_id,
            correlation_id=parent_context.correlation_id,
            causation_id=parent_context.command_id,
        )
        idempotency_key = idempotency_key or f"parent:{parent.id}:chunk:{chunk_key}"
    context = operation_context or build_operation_context(actor_id=created_by_id)
    canonical = {
        "type": job_type,
        "payload": payload,
        "parent_job_id": str(parent_job_id) if parent_job_id else None,
        "chunk_key": chunk_key,
        "priority": priority,
        "progress_total": progress_total,
        "max_attempts": max_attempts,
    }
    request_hash = _request_hash(canonical)

    if idempotency_key:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {"lock_key": _idempotency_lock_key(workspace_id, idempotency_key)},
        )
        existing = await db.scalar(
            select(Job).where(
                Job.workspace_id == workspace_id,
                Job.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            if existing.request_hash is not None and existing.request_hash != request_hash:
                await db.rollback()
                raise ProblemDetailsError(
                    status=409,
                    code="JOB_IDEMPOTENCY_KEY_REUSED",
                    title="Job idempotency key reused",
                    detail="This job idempotency key was used for a different request.",
                    problem_type="https://vhb.local/problems/job-idempotency-key-reused",
                )
            if existing.request_hash is None:
                existing.request_hash = request_hash
                await db.commit()
            return existing
    job = Job(
        workspace_id=workspace_id,
        created_by_id=created_by_id,
        parent_job_id=parent_job_id,
        chunk_key=chunk_key,
        type=job_type,
        payload=payload,
        max_attempts=max_attempts,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        priority=priority,
        progress_total=progress_total,
        operation_context=context.model_dump(mode="json"),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    record_job_event(job.type, "enqueued")
    return job


async def claim_next_job(
    db: AsyncSession,
    *,
    worker_id: str,
    lease_seconds: int,
) -> Job | None:
    now = datetime.now(UTC)
    stale_before = now - timedelta(seconds=lease_seconds)
    age_boost = func.least(
        func.floor(func.extract("epoch", now - Job.created_at) / 60.0),
        20,
    )
    effective_priority = Job.priority + age_boost
    job = await db.scalar(
        select(Job)
        .where(
            Job.attempts < Job.max_attempts,
            Job.cancellation_requested_at.is_(None),
            or_(
                (Job.status == JobStatus.queued) & (Job.run_after <= now),
                (Job.status == JobStatus.running) & (Job.locked_at < stale_before),
            ),
        )
        .order_by(
            effective_priority.desc(),
            Job.run_after,
            Job.created_at,
        )
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if job is None:
        return None
    job.status = JobStatus.running
    job.locked_at = now
    job.locked_by = worker_id
    job.started_at = job.started_at or now
    job.attempts += 1
    await db.commit()
    await db.refresh(job)
    record_job_event(job.type, "claimed")
    record_job_queue_age(job.type, (now - job.created_at).total_seconds())
    if job.attempts > 1:
        record_job_event(job.type, "retried")
    return job


async def update_job_progress(
    db: AsyncSession,
    job: Job,
    *,
    current: int,
    total: int | None = None,
    message: str | None = None,
    checkpoint: dict[str, Any] | None = None,
) -> None:
    if current < 0 or (total is not None and total < 0):
        raise ValueError("Job progress cannot be negative")
    effective_total = total if total is not None else job.progress_total
    if effective_total is not None and current > effective_total:
        raise ValueError("Job progress cannot exceed total")
    job.progress_current = current
    job.progress_total = effective_total
    job.progress_message = message[:500] if message else None
    if checkpoint is not None:
        job.checkpoint = checkpoint
    job.last_progress_at = datetime.now(UTC)
    await db.commit()
    record_job_progress(job.type)


async def request_job_cancellation(db: AsyncSession, job: Job) -> None:
    now = datetime.now(UTC)
    if job.status is JobStatus.queued:
        job.status = JobStatus.cancelled
        job.cancellation_requested_at = now
        job.completed_at = now
        record_job_event(job.type, "cancelled")
    elif job.status is JobStatus.running:
        job.cancellation_requested_at = now
        record_job_event(job.type, "cancellation_requested")
    else:
        raise ValueError("Job cannot be cancelled")
    await db.flush()


async def cancel_job_execution(db: AsyncSession, job: Job) -> None:
    now = datetime.now(UTC)
    job.status = JobStatus.cancelled
    job.completed_at = now
    job.locked_at = None
    job.locked_by = None
    job.error = None
    job.error_details = None
    await db.commit()
    record_job_event(job.type, "cancelled")
    if job.started_at is not None:
        record_job_duration(job.type, job.status, (now - job.started_at).total_seconds())


async def complete_job(
    db: AsyncSession,
    job: Job,
    result: dict[str, Any] | None = None,
) -> None:
    now = datetime.now(UTC)
    job.status = JobStatus.succeeded
    job.result = result or {}
    job.error = None
    job.error_details = None
    job.locked_at = None
    job.locked_by = None
    job.completed_at = now
    if job.progress_total is not None:
        job.progress_current = job.progress_total
    await db.commit()
    record_job_event(job.type, "succeeded")
    if job.started_at is not None:
        record_job_duration(job.type, job.status, (now - job.started_at).total_seconds())


async def fail_job(
    db: AsyncSession,
    job: Job,
    error: str | dict[str, Any],
) -> None:
    details = (
        error
        if isinstance(error, dict)
        else {
            "code": "JOB_EXECUTION_ERROR",
            "kind": "JobExecutionError",
            "message": redact_job_message(error, job.payload),
            "retryable": True,
            "details": {},
        }
    )
    job.error_details = details
    job.error = str(details["message"])[:4000]
    job.locked_at = None
    job.locked_by = None
    retryable = bool(details.get("retryable", False))
    if not retryable or job.attempts >= job.max_attempts:
        job.status = JobStatus.failed
        job.completed_at = datetime.now(UTC)
        record_job_event(job.type, "failed")
        record_job_failure(job.type, str(details.get("code", "UNKNOWN")))
    else:
        job.status = JobStatus.queued
        delay_seconds = min(300, 2 ** max(job.attempts - 1, 0))
        job.run_after = datetime.now(UTC) + timedelta(seconds=delay_seconds)
        record_job_event(job.type, "retry_scheduled")
    await db.commit()
    if job.status is JobStatus.failed and job.started_at is not None:
        assert job.completed_at is not None
        record_job_duration(
            job.type,
            job.status,
            (job.completed_at - job.started_at).total_seconds(),
        )
