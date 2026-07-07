"""Google Drive-backed Files & Media field APIs."""

import re
import tempfile
import uuid
from collections.abc import Iterator
from typing import IO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.database import Database
from app.models.drive_file import DriveFile
from app.models.field import Field, FieldType, Row
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.drive_file import DriveFileOut, DriveStatusOut
from app.services.authorization import Action, require_database_action
from app.services.google_drive import (
    GoogleDriveNotConfiguredError,
    GoogleDriveStorage,
    get_google_drive_storage,
)

router = APIRouter(tags=["drive-files"])
settings = get_settings()


def _safe_filename(filename: str | None) -> str:
    clean = (filename or "file").replace("\\", "/").rsplit("/", 1)[-1]
    clean = re.sub(r"[\x00-\x1f\x7f]", "_", clean).strip(" .")
    return clean[:255] or "file"


async def _scoped_file(
    file_id: uuid.UUID,
    database_id: uuid.UUID,
    workspace: Workspace,
    db: AsyncSession,
) -> DriveFile:
    drive_file = await db.get(DriveFile, file_id)
    if (
        drive_file is None
        or drive_file.workspace_id != workspace.id
        or drive_file.database_id != database_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    return drive_file


@router.get("/integrations/google-drive/status", response_model=DriveStatusOut)
async def drive_status(
    _: Workspace = Depends(get_current_workspace),
    storage: GoogleDriveStorage = Depends(get_google_drive_storage),
) -> DriveStatusOut:
    return DriveStatusOut(
        configured=storage.configured,
        max_file_bytes=settings.google_drive_max_file_bytes,
    )


@router.post(
    "/databases/{database_id}/rows/{row_id}/fields/{field_id}/files",
    response_model=list[DriveFileOut],
    status_code=status.HTTP_201_CREATED,
)
async def upload_drive_files(
    database_id: uuid.UUID,
    row_id: uuid.UUID,
    field_id: uuid.UUID,
    files: list[UploadFile] = File(...),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: GoogleDriveStorage = Depends(get_google_drive_storage),
) -> list[DriveFile]:
    if not storage.configured:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Google Drive storage is not configured",
        )
    if not files or len(files) > 20:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Upload 1 to 20 files")
    database = await db.get(Database, database_id)
    row = await db.get(Row, row_id)
    field = await db.get(Field, field_id)
    if (
        database is None
        or database.workspace_id != workspace.id
        or row is None
        or row.database_id != database.id
        or field is None
        or field.database_id != database.id
        or field.type is not FieldType.files
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Files field or row not found")
    await require_database_action(
        db,
        database_id=database.id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )

    created: list[DriveFile] = []
    external_ids: list[str] = []
    try:
        for upload in files:
            staged: IO[bytes] = tempfile.SpooledTemporaryFile(max_size=5 * 1024 * 1024)
            size = 0
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.google_drive_max_file_bytes:
                    staged.close()
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"{upload.filename or 'File'} exceeds the upload limit",
                    )
                staged.write(chunk)
            staged.seek(0)
            try:
                stored = await storage.upload(
                    staged,
                    filename=_safe_filename(upload.filename),
                    mime_type=upload.content_type or "application/octet-stream",
                )
            finally:
                staged.close()
            external_ids.append(stored.external_id)
            item = DriveFile(
                workspace_id=workspace.id,
                database_id=database.id,
                row_id=row.id,
                field_id=field.id,
                created_by_id=current_user.id,
                google_file_id=stored.external_id,
                filename=stored.name,
                mime_type=stored.mime_type,
                size_bytes=stored.size_bytes or size,
            )
            db.add(item)
            await db.flush()
            created.append(item)
        existing = row.data.get(str(field.id))
        refs = list(existing) if isinstance(existing, list) else []
        refs.extend(
            {
                "id": str(item.id),
                "name": item.filename,
                "mime_type": item.mime_type,
                "size_bytes": item.size_bytes,
            }
            for item in created
        )
        row.data = {**row.data, str(field.id): refs}
        await db.commit()
        for item in created:
            await db.refresh(item)
        return created
    except Exception:
        await db.rollback()
        for external_id in external_ids:
            try:
                await storage.delete(external_id)
            except Exception:
                pass
        raise


@router.get("/databases/{database_id}/drive-files/{file_id}/content")
async def view_drive_file(
    database_id: uuid.UUID,
    file_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: GoogleDriveStorage = Depends(get_google_drive_storage),
) -> StreamingResponse:
    drive_file = await _scoped_file(file_id, database_id, workspace, db)
    await require_database_action(
        db,
        database_id=database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    try:
        content = await storage.download(drive_file.google_file_id)
    except GoogleDriveNotConfiguredError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    def chunks() -> Iterator[bytes]:
        try:
            while chunk := content.read(1024 * 1024):
                yield chunk
        finally:
            content.close()

    filename = drive_file.filename.replace('"', "_")
    return StreamingResponse(
        chunks(),
        media_type=drive_file.mime_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete(
    "/databases/{database_id}/drive-files/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_drive_file(
    database_id: uuid.UUID,
    file_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    storage: GoogleDriveStorage = Depends(get_google_drive_storage),
) -> None:
    drive_file = await _scoped_file(file_id, database_id, workspace, db)
    await require_database_action(
        db,
        database_id=database_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.write,
    )
    await storage.delete(drive_file.google_file_id)
    row = await db.get(Row, drive_file.row_id)
    if row is not None:
        current = row.data.get(str(drive_file.field_id))
        refs = list(current) if isinstance(current, list) else []
        row.data = {
            **row.data,
            str(drive_file.field_id): [
                ref for ref in refs if str(ref.get("id")) != str(drive_file.id)
            ],
        }
    await db.delete(drive_file)
    await db.commit()
