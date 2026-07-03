"""Field + Row schemas for the database engine."""

import uuid
from typing import Any, Literal

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


class BulkRowCreate(BaseModel):
    count: int = PField(ge=1, le=100)


class RowOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    data: dict[str, Any]
    seq: int


class RowFilter(BaseModel):
    field_id: str
    operator: Literal["eq", "neq", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"]
    value: Any = None


class RowSort(BaseModel):
    field_id: str
    direction: Literal["asc", "desc"] = "asc"


class RowAggregation(BaseModel):
    field_id: str
    function: Literal["count", "sum", "avg", "min", "max"]


class RowQuery(BaseModel):
    page: int = PField(default=1, ge=1)
    page_size: int = PField(default=50, ge=1, le=200)
    filters: list[RowFilter] = PField(default_factory=list, max_length=20)
    sorts: list[RowSort] = PField(default_factory=list, max_length=5)
    aggregations: list[RowAggregation] = PField(default_factory=list, max_length=20)


class RowPage(BaseModel):
    items: list[RowOut]
    page: int
    page_size: int
    total: int
    pages: int
    aggregates: dict[str, Any] = PField(default_factory=dict)


class ReorderRequest(BaseModel):
    ids: list[uuid.UUID]


class FormulaPreview(BaseModel):
    expression: str


class FormulaPreviewResult(BaseModel):
    value: Any
    type: str
    error: str | None = None
