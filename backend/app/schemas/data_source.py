"""DataSource schemas."""

import uuid

from pydantic import BaseModel, ConfigDict
from pydantic import Field as PField

from app.models.data_source import DataSourceKind


class DataSourceCreate(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    description: str | None = None


class DataSourceUpdate(BaseModel):
    name: str | None = PField(default=None, min_length=1, max_length=200)
    description: str | None = None
    order: int | None = None


class DataSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    database_id: uuid.UUID
    name: str
    description: str | None
    kind: DataSourceKind
    is_primary: bool
    origin_asset_id: uuid.UUID | None
    origin_job_id: uuid.UUID | None
    order: int
