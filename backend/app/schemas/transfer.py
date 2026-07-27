"""Database import/export job schemas."""

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.field import FieldType
from app.schemas.data_source import DataSourceOut
from app.schemas.job import JobOut


class DatabaseImportCreate(BaseModel):
    asset_id: uuid.UUID
    format: Literal["csv", "xlsx"]
    mapping: dict[str, uuid.UUID] = Field(default_factory=dict)
    field_types: dict[str, FieldType] = Field(default_factory=dict)
    # Explicitly ignored source columns. This is separate from ``mapping`` so
    # an omitted mapping can continue to mean "create a matching field".
    skipped_columns: list[str] = Field(default_factory=list)
    # The source column selected as the mandatory system Name. UID is always
    # generated from the destination database sequence and cannot be mapped.
    name_column: str = ""
    # Zero-based data-row indexes selected in the review dialog. Omit to use
    # all rows.
    include_rows: list[int] | None = Field(default=None, max_length=100_000)
    incoming_duplicate_policy: Literal["skip", "suffix"] = "suffix"
    existing_name_policy: Literal["update", "suffix"] = "suffix"
    create_missing_fields: bool = True
    # Reuse an existing data source instead of creating a new one for this import.
    data_source_id: uuid.UUID | None = None
    # Name for the new data source this import creates (ignored if data_source_id
    # is given). Defaults to a timestamped name when omitted.
    data_source_name: str | None = None


class DatabaseExportCreate(BaseModel):
    format: Literal["csv", "xlsx"] = "xlsx"
    entity_ids: list[uuid.UUID] | None = Field(default=None, max_length=100_000)


class TransferJobOut(BaseModel):
    job: JobOut
    data_source: DataSourceOut | None = None


class ImportPreviewColumn(BaseModel):
    header: str
    inferred_type: str
    samples: list[Any]
    generated_options: list[str] = Field(default_factory=list)


class DatabaseImportPreview(BaseModel):
    columns: list[ImportPreviewColumn]
    rows: list[list[Any]]
    entity_count: int
    duplicate_names: dict[str, list[int]] = Field(default_factory=dict)
    existing_name_matches: list[str] = Field(default_factory=list)
