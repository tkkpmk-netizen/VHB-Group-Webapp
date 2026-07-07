"""Block document schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DocumentCreate(BaseModel):
    title: str = Field(default="Untitled", min_length=1, max_length=255)
    folder_id: uuid.UUID | None = None
    icon: str | None = Field(default=None, max_length=32)


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: uuid.UUID | None = None
    icon: str | None = Field(default=None, max_length=32)


class DocumentContentUpdate(BaseModel):
    content: list[dict[str, Any]] = Field(max_length=5000)
    expected_version: int = Field(ge=1)


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    folder_id: uuid.UUID | None
    created_by_id: uuid.UUID
    updated_by_id: uuid.UUID
    title: str
    icon: str | None
    content: list[dict[str, Any]]
    version: int
