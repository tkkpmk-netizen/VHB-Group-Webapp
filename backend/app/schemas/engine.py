"""Field + Entity schemas for the database engine."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField

from app.models.field import FieldType


class FieldCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    type: FieldType
    icon: str | None = PField(default=None, max_length=64)
    icon_color: str | None = PField(default=None, max_length=32)
    options: dict[str, Any] = PField(default_factory=dict)


class FieldUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    icon: str | None = PField(default=None, max_length=64)
    icon_color: str | None = PField(default=None, max_length=32)
    options: dict[str, Any] | None = None


class FieldOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    name: str
    type: FieldType
    icon: str | None
    icon_color: str | None
    options: dict[str, Any]
    order: int


class FieldTypeConversionRequest(BaseModel):
    target_type: FieldType
    options: dict[str, Any] = PField(default_factory=dict)
    dry_run: bool = True


class FieldTypeConversionResult(BaseModel):
    field: FieldOut | None = None
    source_type: FieldType
    target_type: FieldType
    total_cells: int
    converted_cells: int
    cleared_cells: int
    empty_cells: int
    generated_choices: int = 0
    cleared_samples: list[str] = PField(default_factory=list)


class EntityCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    data: dict[str, Any] = PField(default_factory=dict)
    # Which data source this entity belongs to. Omit to use the database's
    # primary (default/manual) source.
    data_source_id: uuid.UUID | None = None


class EntityUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    data: dict[str, Any] = PField(default_factory=dict)


class BulkEntityCreate(BaseModel):
    names: list[str] = PField(min_length=1, max_length=100)
    data_source_id: uuid.UUID | None = None


class EntityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    data_source_id: uuid.UUID
    data: dict[str, Any]
    uid: str
    name: str
    seq: int


class EntityFilter(BaseModel):
    field_id: str
    operator: Literal["eq", "neq", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"]
    value: Any = None


class EntitySort(BaseModel):
    field_id: str
    direction: Literal["asc", "desc"] = "asc"


class EntityAggregation(BaseModel):
    field_id: str
    function: Literal[
        "count",
        "filled",
        "empty",
        "unique",
        "percent_filled",
        "sum",
        "avg",
        "min",
        "max",
    ]


class EntityQuery(BaseModel):
    page: int = PField(default=1, ge=1)
    page_size: int = PField(default=50, ge=1, le=200)
    filters: list[EntityFilter] = PField(default_factory=list, max_length=20)
    sorts: list[EntitySort] = PField(default_factory=list, max_length=5)
    aggregations: list[EntityAggregation] = PField(default_factory=list, max_length=20)
    group_by: str | None = None


class SubItemTreeQuery(BaseModel):
    """Loaded Table entities whose connected sub-item trees are needed."""

    entity_ids: list[uuid.UUID] = PField(min_length=1, max_length=200)


class EntityGroup(BaseModel):
    key: Any
    aggregates: dict[str, Any] = PField(default_factory=dict)


class EntityPage(BaseModel):
    items: list[EntityOut]
    page: int
    page_size: int
    total: int
    pages: int
    aggregates: dict[str, Any] = PField(default_factory=dict)
    groups: list[EntityGroup] = PField(default_factory=list)


class ReorderRequest(BaseModel):
    ids: list[uuid.UUID]


class FormulaPreview(BaseModel):
    expression: str


class FormulaPreviewResult(BaseModel):
    value: Any
    type: str
    error: str | None = None
