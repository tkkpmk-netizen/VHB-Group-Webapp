"""Field + Row schemas for the database engine."""

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField

from app.models.field import FieldType


class FieldCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    type: FieldType
    options: dict[str, Any] = PField(default_factory=dict)


class FieldUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    options: dict[str, Any] | None = None


class FieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    name: str
    type: FieldType
    options: dict[str, Any]
    order: int


class RowCreate(BaseModel):
    data: dict[str, Any] = PField(default_factory=dict)


class RowUpdate(BaseModel):
    data: dict[str, Any]


class RowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    data: dict[str, Any]
    seq: int


class ReorderRequest(BaseModel):
    ids: list[uuid.UUID]
