"""ViewPreset schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField


class ViewPresetCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    filter: dict[str, Any] = PField(default_factory=dict)
    sorts: list[Any] = PField(default_factory=list)
    group_field_id: str | None = None
    hide_empty: bool = False


class ViewPresetUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    filter: dict[str, Any] | None = None
    sorts: list[Any] | None = None
    group_field_id: str | None = None
    hide_empty: bool | None = None
    order: int | None = None


class ViewPresetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    layout_id: uuid.UUID
    name: str
    filter: dict[str, Any]
    sorts: list[Any]
    group_field_id: str | None
    hide_empty: bool
    order: int
