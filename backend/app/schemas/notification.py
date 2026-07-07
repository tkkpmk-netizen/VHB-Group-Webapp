"""Notification API schemas."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    type: str
    title: str
    body: str
    data: dict[str, Any]
    read_at: datetime | None
    emailed_at: datetime | None
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


class NotificationPreferenceUpdate(BaseModel):
    in_app_enabled: bool
    email_enabled: bool


class NotificationPreferenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    in_app_enabled: bool
    email_enabled: bool
