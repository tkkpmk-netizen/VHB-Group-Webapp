"""Durable job API schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.job import JobStatus


class JobCreate(BaseModel):
    type: str = Field(min_length=1, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=200)
    max_attempts: int | None = Field(default=None, ge=1, le=10)
    parent_job_id: uuid.UUID | None = None
    chunk_key: str | None = Field(default=None, min_length=1, max_length=200)
    priority: int = Field(default=0, ge=-10, le=10)
    progress_total: int | None = Field(default=None, ge=0)


class OperationContext(BaseModel):
    request_id: str = Field(min_length=1, max_length=200)
    command_id: str = Field(min_length=1, max_length=200)
    correlation_id: str = Field(min_length=1, max_length=200)
    causation_id: str | None = Field(default=None, max_length=200)
    actor_id: uuid.UUID


class JobErrorDetails(BaseModel):
    code: str
    kind: str
    message: str
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    created_by_id: uuid.UUID
    parent_job_id: uuid.UUID | None
    chunk_key: str | None
    type: str
    status: JobStatus
    payload: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    error_details: dict[str, Any] | None
    operation_context: dict[str, Any]
    checkpoint: dict[str, Any]
    priority: int
    progress_current: int
    progress_total: int | None
    progress_message: str | None
    attempts: int
    max_attempts: int
    run_after: datetime
    locked_at: datetime | None
    locked_by: str | None
    idempotency_key: str | None
    request_hash: str | None
    cancellation_requested_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    last_progress_at: datetime | None
