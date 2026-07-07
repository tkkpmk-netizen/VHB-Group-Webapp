"""Asset API schemas."""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from app.models.asset import AssetStatus


class AssetUploadCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(ge=1, le=1024 * 1024 * 1024)


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    created_by_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    status: AssetStatus


class AssetUploadOut(BaseModel):
    asset: AssetOut
    upload_url: str
    expires_in: int


class AssetDownloadOut(BaseModel):
    download_url: str
    expires_in: int
