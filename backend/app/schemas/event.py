"""Audit event schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    data: dict[str, Any]
    ip_address: str | None
    user_agent: str | None
    created_at: datetime
