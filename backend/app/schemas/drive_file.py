"""Google Drive file schemas."""

import uuid

from pydantic import BaseModel, ConfigDict


class DriveStatusOut(BaseModel):
    configured: bool
    max_file_bytes: int


class DriveFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    database_id: uuid.UUID
    entity_id: uuid.UUID
    field_id: uuid.UUID
    filename: str
    mime_type: str
    size_bytes: int
