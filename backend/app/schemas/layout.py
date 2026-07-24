"""Layout schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField

from app.models.layout import LayoutType


class LayoutCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    type: LayoutType = LayoutType.table
    icon: str | None = PField(default=None, max_length=64)
    icon_color: str | None = PField(default=None, max_length=32)
    config: dict[str, Any] = PField(default_factory=dict)


class LayoutUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    type: LayoutType | None = None
    icon: str | None = PField(default=None, max_length=64)
    icon_color: str | None = PField(default=None, max_length=32)
    config: dict[str, Any] | None = None
    order: int | None = None
    # Nullable, so the endpoint checks model_fields_set rather than
    # "is not None" — that's the only way to distinguish "leave it alone"
    # from "explicitly clear the active preset."
    active_view_preset_id: uuid.UUID | None = None


class LayoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    placement_id: uuid.UUID | None
    source_layout_id: uuid.UUID | None
    name: str
    type: LayoutType
    icon: str | None
    icon_color: str | None
    config: dict[str, Any]
    order: int
    active_view_preset_id: uuid.UUID | None
