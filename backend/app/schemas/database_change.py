"""Database change-history API schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DatabaseFieldChangeOut(BaseModel):
    field_id: uuid.UUID
    field_name: str
    before_value: Any = None
    after_value: Any = None


class DatabaseChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    actor_id: uuid.UUID | None
    actor_name: str | None = None
    actor_email: str | None = None
    action: str
    summary: str
    field_changes: list[DatabaseFieldChangeOut] = Field(default_factory=list)
    reverted_at: datetime | None
    reverted_by_id: uuid.UUID | None
    created_at: datetime


class DatabaseChangeRestoreResult(BaseModel):
    restored_change: DatabaseChangeOut
    restored: dict[str, int] = Field(default_factory=dict)
    affected_ids: dict[str, list[uuid.UUID]] = Field(default_factory=dict)
    detail: dict[str, Any] = Field(default_factory=dict)
