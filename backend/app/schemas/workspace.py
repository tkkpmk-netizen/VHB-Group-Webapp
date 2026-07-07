"""Workspace + database schemas."""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models.workspace import MemberRole


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    member_count: int = 0
    role: MemberRole | None = None


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str | None = None
    role: MemberRole


class MembershipOut(BaseModel):
    id: uuid.UUID
    name: str
    role: MemberRole


class MemberRoleUpdate(BaseModel):
    role: MemberRole


class MemberAdd(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: MemberRole = MemberRole.editor


class DatabaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=16)
    folder_id: uuid.UUID | None = None


class DatabaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    folder_id: uuid.UUID | None
    name: str
    icon: str | None
