"""Dashboard designer schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.dashboard import WidgetType
from app.schemas.engine import EntityPage, EntityQuery


class DashboardCreate(BaseModel):
    space_id: uuid.UUID
    name: str = Field(default="Untitled dashboard", min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    is_default: bool = False


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    is_default: bool | None = None


class DashboardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    space_id: uuid.UUID
    name: str
    description: str | None
    is_default: bool


class WidgetCreate(BaseModel):
    database_id: uuid.UUID
    title: str = Field(min_length=1, max_length=200)
    type: WidgetType
    query: EntityQuery = Field(default_factory=EntityQuery)
    visualization: dict[str, Any] = Field(default_factory=dict)


class WidgetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    type: WidgetType | None = None
    query: EntityQuery | None = None
    visualization: dict[str, Any] | None = None
    order: int | None = Field(default=None, ge=0)


class WidgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dashboard_id: uuid.UUID
    database_id: uuid.UUID
    title: str
    type: WidgetType
    query: dict[str, Any]
    visualization: dict[str, Any]
    order: int


class WidgetDataOut(BaseModel):
    widget_id: uuid.UUID
    data: EntityPage
