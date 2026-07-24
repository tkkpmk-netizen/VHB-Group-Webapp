"""CM7 Google Drive-backed Files & Media tests."""

import io

import httpx
import pytest

from app.main import app
from app.services.google_drive import DriveObject, get_google_drive_storage


class FakeDrive:
    configured = True

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def upload(
        self, file: io.BufferedIOBase, *, filename: str, mime_type: str
    ) -> DriveObject:
        external_id = f"drive-{len(self.objects) + 1}"
        content = file.read()
        self.objects[external_id] = content
        return DriveObject(external_id, filename, mime_type, len(content))

    async def download(self, external_id: str) -> io.BytesIO:
        return io.BytesIO(self.objects[external_id])

    async def delete(self, external_id: str) -> None:
        self.deleted.append(external_id)
        self.objects.pop(external_id, None)


async def _register(client: httpx.AsyncClient) -> dict[str, str]:
    response = await client.post(
        "/auth/signup",
        json={
            "email": "drive-files@example.com",
            "password": "supersecret1",
            "full_name": "CM7",
        },
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return {**auth, "X-Workspace-ID": workspace["id"]}


@pytest.mark.asyncio
async def test_upload_preview_and_delete_drive_file(client: httpx.AsyncClient) -> None:
    headers = await _register(client)
    drive = FakeDrive()
    app.dependency_overrides[get_google_drive_storage] = lambda: drive
    database = await client.post("/databases", json={"name": "Media"}, headers=headers)
    database_id = database.json()["id"]
    field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Files", "type": "files", "options": {}},
        headers=headers,
    )
    entity = await client.post(
        f"/databases/{database_id}/entities",
        json={"name": "Test entity", "data": {}},
        headers=headers,
    )
    upload = await client.post(
        f"/databases/{database_id}/entities/{entity.json()['id']}"
        f"/fields/{field.json()['id']}/files",
        files={"files": ("photo.png", b"fake-png", "image/png")},
        headers=headers,
    )
    assert upload.status_code == 201, upload.text
    drive_file = upload.json()[0]
    entities = await client.get(f"/databases/{database_id}/entities", headers=headers)
    cell = entities.json()[0]["data"][field.json()["id"]]
    assert cell[0]["id"] == drive_file["id"]

    content = await client.get(
        f"/databases/{database_id}/drive-files/{drive_file['id']}/content",
        headers=headers,
    )
    assert content.status_code == 200
    assert content.content == b"fake-png"
    assert content.headers["content-type"] == "image/png"

    deleted = await client.delete(
        f"/databases/{database_id}/drive-files/{drive_file['id']}",
        headers=headers,
    )
    assert deleted.status_code == 204
    assert drive.deleted == ["drive-1"]
    entities = await client.get(f"/databases/{database_id}/entities", headers=headers)
    assert entities.json()[0]["data"][field.json()["id"]] == []


@pytest.mark.asyncio
async def test_delete_entity_cleans_drive_file(
    client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = await _register(client)
    drive = FakeDrive()
    app.dependency_overrides[get_google_drive_storage] = lambda: drive
    monkeypatch.setattr("app.services.drive_file_cleanup.get_google_drive_storage", lambda: drive)
    database = await client.post("/databases", json={"name": "Media cleanup"}, headers=headers)
    database_id = database.json()["id"]
    field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Files", "type": "files", "options": {}},
        headers=headers,
    )
    entity = await client.post(
        f"/databases/{database_id}/entities",
        json={"name": "Test entity", "data": {}},
        headers=headers,
    )
    upload = await client.post(
        f"/databases/{database_id}/entities/{entity.json()['id']}"
        f"/fields/{field.json()['id']}/files",
        files={"files": ("contract.pdf", b"fake-pdf", "application/pdf")},
        headers=headers,
    )
    assert upload.status_code == 201, upload.text

    deleted = await client.delete(f"/entities/{entity.json()['id']}", headers=headers)
    assert deleted.status_code == 204
    assert drive.deleted == ["drive-1"]
    assert drive.objects == {}
