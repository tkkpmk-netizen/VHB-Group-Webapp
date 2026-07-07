"""Database import/export job schemas."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.job import JobOut


class DatabaseImportCreate(BaseModel):
    asset_id: uuid.UUID
    format: Literal["csv", "xlsx"]
    mapping: dict[str, uuid.UUID] = Field(default_factory=dict)
    create_missing_fields: bool = True


class DatabaseExportCreate(BaseModel):
    format: Literal["csv", "xlsx"] = "xlsx"


class TransferJobOut(BaseModel):
    job: JobOut
