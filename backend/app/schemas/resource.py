"""Space and folder resource-tree schemas."""

import uuid

from pydantic import BaseModel, ConfigDict, Field


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=32)


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=32)
    order: int | None = Field(default=None, ge=0)


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    icon: str | None
    color: str | None
    order: int


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None
    order: int | None = Field(default=None, ge=0)


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    space_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    order: int
