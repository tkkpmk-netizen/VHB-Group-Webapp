"""Workspace + database schemas."""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    member_count: int = 0


class DatabaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=16)


class DatabaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    icon: str | None
