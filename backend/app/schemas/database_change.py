"""Database change-history API schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DatabaseChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    summary: str
    reverted_at: datetime | None
    reverted_by_id: uuid.UUID | None
    created_at: datetime


class DatabaseChangeRestoreResult(BaseModel):
    restored_change: DatabaseChangeOut
    restored: dict[str, int] = Field(default_factory=dict)
    affected_ids: dict[str, list[uuid.UUID]] = Field(default_factory=dict)
    detail: dict[str, Any] = Field(default_factory=dict)
