"""Google Shared Drive storage abstraction."""

import asyncio
import tempfile
from dataclasses import dataclass
from functools import lru_cache
from typing import IO, Any, Protocol

from google.oauth2 import service_account
from googleapiclient.discovery import build  # type: ignore[import-untyped]
from googleapiclient.http import (  # type: ignore[import-untyped]
    MediaIoBaseDownload,
    MediaIoBaseUpload,
)

from app.core.config import get_settings

DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"


class GoogleDriveNotConfiguredError(RuntimeError):
    pass


@dataclass(frozen=True)
class DriveObject:
    external_id: str
    name: str
    mime_type: str
    size_bytes: int


class GoogleDriveStorage(Protocol):
    @property
    def configured(self) -> bool: ...

    async def upload(self, file: IO[bytes], *, filename: str, mime_type: str) -> DriveObject: ...

    async def download(self, external_id: str) -> IO[bytes]: ...

    async def delete(self, external_id: str) -> None: ...


class GoogleDriveAPI:
    def __init__(self) -> None:
        settings = get_settings()
        self.credentials_file = settings.google_drive_service_account_file
        self.folder_id = settings.google_drive_folder_id

    @property
    def configured(self) -> bool:
        return bool(self.credentials_file and self.folder_id)

    def _service(self) -> Any:
        if not self.configured or not self.credentials_file:
            raise GoogleDriveNotConfiguredError("Google Drive storage is not configured")
        credentials = service_account.Credentials.from_service_account_file(  # type: ignore[no-untyped-call]
            self.credentials_file,
            scopes=[DRIVE_FILE_SCOPE],
        )
        return build("drive", "v3", credentials=credentials, cache_discovery=False)

    async def upload(self, file: IO[bytes], *, filename: str, mime_type: str) -> DriveObject:
        def _upload() -> DriveObject:
            service = self._service()
            file.seek(0)
            media = MediaIoBaseUpload(
                file,
                mimetype=mime_type,
                chunksize=5 * 1024 * 1024,
                resumable=True,
            )
            result = (
                service.files()
                .create(
                    body={"name": filename, "parents": [self.folder_id]},
                    media_body=media,
                    fields="id,name,mimeType,size",
                    supportsAllDrives=True,
                )
                .execute()
            )
            return DriveObject(
                external_id=str(result["id"]),
                name=str(result.get("name") or filename),
                mime_type=str(result.get("mimeType") or mime_type),
                size_bytes=int(result.get("size") or 0),
            )

        return await asyncio.to_thread(_upload)

    async def download(self, external_id: str) -> IO[bytes]:
        def _download() -> IO[bytes]:
            service = self._service()
            request = service.files().get_media(
                fileId=external_id,
                supportsAllDrives=True,
            )
            output = tempfile.SpooledTemporaryFile(max_size=5 * 1024 * 1024)
            downloader = MediaIoBaseDownload(output, request, chunksize=5 * 1024 * 1024)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            output.seek(0)
            return output

        return await asyncio.to_thread(_download)

    async def delete(self, external_id: str) -> None:
        def _delete() -> None:
            service = self._service()
            service.files().delete(
                fileId=external_id,
                supportsAllDrives=True,
            ).execute()

        await asyncio.to_thread(_delete)


@lru_cache
def get_google_drive_storage() -> GoogleDriveStorage:
    return GoogleDriveAPI()
