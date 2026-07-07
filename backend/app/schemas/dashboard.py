"""Dashboard designer schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.dashboard import WidgetType
from app.schemas.engine import RowPage, RowQuery


class DashboardCreate(BaseModel):
    name: str = Field(default="Untitled dashboard", min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)


class DashboardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)


class DashboardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str | None


class WidgetCreate(BaseModel):
    database_id: uuid.UUID
    title: str = Field(min_length=1, max_length=200)
    type: WidgetType
    query: RowQuery = Field(default_factory=RowQuery)
    visualization: dict[str, Any] = Field(default_factory=dict)


class WidgetUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    type: WidgetType | None = None
    query: RowQuery | None = None
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
    data: RowPage
