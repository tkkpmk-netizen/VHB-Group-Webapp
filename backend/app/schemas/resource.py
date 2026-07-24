"""Space and folder resource-tree schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.workspace import DatabaseOut


class SpaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=32)


class SpaceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    icon: str | None = Field(default=None, max_length=64)
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
    icon: str | None = Field(default=None, max_length=64)
    icon_color: str | None = Field(default=None, max_length=32)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None
    icon: str | None = Field(default=None, max_length=64)
    icon_color: str | None = Field(default=None, max_length=32)
    order: int | None = Field(default=None, ge=0)


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    space_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    icon: str | None
    icon_color: str | None
    order: int


class SpaceDatabaseCreate(BaseModel):
    database_id: uuid.UUID
    folder_id: uuid.UUID | None = None
    layout_id: uuid.UUID | None = None
    settings: dict[str, Any] = Field(default_factory=dict)


class SpaceDatabaseUpdate(BaseModel):
    folder_id: uuid.UUID | None = None
    layout_id: uuid.UUID | None = None
    order: int | None = Field(default=None, ge=0)
    settings: dict[str, Any] | None = None


class SpaceDatabaseOrderItem(BaseModel):
    id: uuid.UUID
    folder_id: uuid.UUID | None = None
    order: int = Field(ge=0)


class SpaceDatabaseReorder(BaseModel):
    items: list[SpaceDatabaseOrderItem] = Field(min_length=1, max_length=500)


class SpaceDatabaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    space_id: uuid.UUID
    database_id: uuid.UUID
    folder_id: uuid.UUID | None
    layout_id: uuid.UUID | None
    order: int
    settings: dict[str, Any]
    database: DatabaseOut
