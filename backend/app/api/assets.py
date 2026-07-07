"""Workspace-scoped object-storage asset APIs."""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.asset import Asset, AssetStatus
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.asset import (
    AssetDownloadOut,
    AssetOut,
    AssetUploadCreate,
    AssetUploadOut,
)
from app.services.storage import (
    ObjectStorage,
    StoredObjectNotFoundError,
    get_object_storage,
)

router = APIRouter(prefix="/assets", tags=["assets"])
settings = get_settings()


def _safe_filename(filename: str) -> str:
    clean = filename.replace("\\", "/").rsplit("/", 1)[-1]
    clean = re.sub(r"[^A-Za-z0-9._ -]", "_", clean).strip(" .")
    return clean[:255] or "file"


async def _scoped_asset(asset_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> Asset:
    asset = await db.get(Asset, asset_id)
    if asset is None or asset.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Asset not found")
    return asset


@router.get("", response_model=list[AssetOut])
async def list_assets(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[Asset]:
    result = await db.execute(
        select(Asset)
        .where(Asset.workspace_id == workspace.id)
        .order_by(Asset.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(result.scalars())


@router.post(
    "/uploads",
    response_model=AssetUploadOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_upload(
    payload: AssetUploadCreate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> AssetUploadOut:
    asset_id = uuid.uuid4()
    filename = _safe_filename(payload.filename)
    object_key = f"workspaces/{workspace.id}/assets/{asset_id}/{filename}"
    asset = Asset(
        id=asset_id,
        workspace_id=workspace.id,
        created_by_id=current_user.id,
        object_key=object_key,
        filename=filename,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        status=AssetStatus.pending,
    )
    db.add(asset)
    upload_url = await storage.presign_upload(
        object_key,
        content_type=payload.content_type,
        expires_seconds=settings.storage_presign_ttl_seconds,
    )
    await db.commit()
    await db.refresh(asset)
    return AssetUploadOut(
        asset=AssetOut.model_validate(asset),
        upload_url=upload_url,
        expires_in=settings.storage_presign_ttl_seconds,
    )


@router.post("/{asset_id}/complete", response_model=AssetOut)
async def complete_upload(
    asset_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> Asset:
    asset = await _scoped_asset(asset_id, workspace, db)
    try:
        actual_size = await storage.object_size(asset.object_key)
    except StoredObjectNotFoundError as exc:
        asset.status = AssetStatus.failed
        await db.commit()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Uploaded object not found"
        ) from exc
    if actual_size != asset.size_bytes:
        asset.status = AssetStatus.failed
        await db.commit()
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Size mismatch: expected {asset.size_bytes}, received {actual_size}",
        )
    asset.status = AssetStatus.ready
    await db.commit()
    await db.refresh(asset)
    return asset


@router.get("/{asset_id}/download", response_model=AssetDownloadOut)
async def create_download(
    asset_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> AssetDownloadOut:
    asset = await _scoped_asset(asset_id, workspace, db)
    if asset.status is not AssetStatus.ready:
        raise HTTPException(status.HTTP_409_CONFLICT, "Asset is not ready")
    url = await storage.presign_download(
        asset.object_key,
        filename=asset.filename,
        expires_seconds=settings.storage_presign_ttl_seconds,
    )
    return AssetDownloadOut(download_url=url, expires_in=settings.storage_presign_ttl_seconds)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
    storage: ObjectStorage = Depends(get_object_storage),
) -> None:
    asset = await _scoped_asset(asset_id, workspace, db)
    await storage.delete(asset.object_key)
    await db.delete(asset)
    await db.commit()
