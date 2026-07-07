"""External Google Drive cleanup for database resource deletion."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.drive_file import DriveFile
from app.services.google_drive import get_google_drive_storage


async def cleanup_drive_files(
    db: AsyncSession,
    *,
    database_id: uuid.UUID | None = None,
    row_id: uuid.UUID | None = None,
    field_id: uuid.UUID | None = None,
) -> None:
    query = select(DriveFile)
    if database_id is not None:
        query = query.where(DriveFile.database_id == database_id)
    if row_id is not None:
        query = query.where(DriveFile.row_id == row_id)
    if field_id is not None:
        query = query.where(DriveFile.field_id == field_id)
    files = list((await db.execute(query)).scalars())
    if not files:
        return
    storage = get_google_drive_storage()
    for drive_file in files:
        await storage.delete(drive_file.google_file_id)
