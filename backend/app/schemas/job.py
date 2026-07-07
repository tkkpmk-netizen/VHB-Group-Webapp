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


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    created_by_id: uuid.UUID
    type: str
    status: JobStatus
    payload: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    attempts: int
    max_attempts: int
    run_after: datetime
    locked_at: datetime | None
    locked_by: str | None
    idempotency_key: str | None
