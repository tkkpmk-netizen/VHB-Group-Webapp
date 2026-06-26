"""View schemas."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField

from app.models.view import ViewType


class ViewCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    type: ViewType = ViewType.table
    config: dict[str, Any] = PField(default_factory=dict)


class ViewUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    type: ViewType | None = None
    config: dict[str, Any] | None = None


class ViewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    name: str
    type: ViewType
    config: dict[str, Any]
    order: int
