"""F5 object storage and F6 durable job integration tests."""

from collections.abc import AsyncGenerator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.main import app
from app.models.job import JobStatus
from app.services.jobs import claim_next_job, complete_job, fail_job
from app.services.storage import StoredObjectNotFoundError, get_object_storage


class FakeStorage:
    def __init__(self) -> None:
        self.sizes: dict[str, int] = {}
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    async def presign_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str:
        return f"https://storage.test/upload/{key}?type={content_type}"

    async def presign_download(self, key: str, *, filename: str, expires_seconds: int) -> str:
        return f"https://storage.test/download/{key}?filename={filename}"

    async def object_size(self, key: str) -> int:
        if key not in self.sizes:
            raise StoredObjectNotFoundError(key)
        return self.sizes[key]

    async def delete(self, key: str) -> None:
        self.deleted.append(key)

    async def get_bytes(self, key: str) -> bytes:
        return self.objects[key]

    async def put_bytes(self, key: str, data: bytes, *, content_type: str) -> None:
        self.objects[key] = data
        self.sizes[key] = len(data)


async def _register(client: httpx.AsyncClient, email: str) -> tuple[dict[str, str], str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "F"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    headers = {**auth, "X-Workspace-ID": workspace["id"]}
    return headers, workspace["id"]


@pytest.mark.asyncio
async def test_asset_upload_complete_download_delete(client: httpx.AsyncClient) -> None:
    storage = FakeStorage()
    app.dependency_overrides[get_object_storage] = lambda: storage
    headers, _ = await _register(client, "assets@example.com")

    response = await client.post(
        "/assets/uploads",
        json={
            "filename": "../../report.csv",
            "content_type": "text/csv",
            "size_bytes": 12,
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body = response.json()
    asset_id = body["asset"]["id"]
    assert body["asset"]["filename"] == "report.csv"
    assert body["asset"]["status"] == "pending"
    assert body["upload_url"].startswith("https://storage.test/upload/")

    assets = await client.get("/assets", headers=headers)
    assert len(assets.json()) == 1
    object_key = next(iter(storage.sizes), None)
    assert object_key is None
    upload_key = body["upload_url"].split("/upload/", 1)[1].split("?", 1)[0]
    storage.sizes[upload_key] = 12

    complete = await client.post(f"/assets/{asset_id}/complete", headers=headers)
    assert complete.status_code == 200, complete.text
    assert complete.json()["status"] == "ready"

    download = await client.get(f"/assets/{asset_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.json()["download_url"].startswith("https://storage.test/download/")

    deleted = await client.delete(f"/assets/{asset_id}", headers=headers)
    assert deleted.status_code == 204
    assert storage.deleted == [upload_key]


@pytest.mark.asyncio
async def test_assets_are_workspace_isolated(client: httpx.AsyncClient) -> None:
    storage = FakeStorage()
    app.dependency_overrides[get_object_storage] = lambda: storage
    headers_a, _ = await _register(client, "assets-a@example.com")
    headers_b, _ = await _register(client, "assets-b@example.com")
    asset = await client.post(
        "/assets/uploads",
        json={"filename": "a.txt", "content_type": "text/plain", "size_bytes": 1},
        headers=headers_a,
    )
    response = await client.get(
        f"/assets/{asset.json()['asset']['id']}/download", headers=headers_b
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_job_idempotency_claim_complete_and_retry(
    client: httpx.AsyncClient,
) -> None:
    headers, _ = await _register(client, "jobs@example.com")
    payload = {
        "type": "system.noop",
        "payload": {"source": "test"},
        "idempotency_key": "noop-1",
    }
    first = await client.post("/jobs", json=payload, headers=headers)
    second = await client.post("/jobs", json=payload, headers=headers)
    assert first.status_code == 202
    assert second.json()["id"] == first.json()["id"]

    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    session = await anext(generator)
    try:
        job = await claim_next_job(session, worker_id="test-worker", lease_seconds=60)
        assert job is not None
        assert job.status == JobStatus.running
        assert job.attempts == 1
        await complete_job(session, job, {"ok": True})
    finally:
        await generator.aclose()

    completed = await client.get(f"/jobs/{first.json()['id']}", headers=headers)
    assert completed.json()["status"] == "succeeded"
    assert completed.json()["result"] == {"ok": True}


@pytest.mark.asyncio
async def test_job_failure_requeues_then_exhausts(client: httpx.AsyncClient) -> None:
    headers, _ = await _register(client, "job-failure@example.com")
    created = await client.post(
        "/jobs",
        json={"type": "system.noop", "max_attempts": 2},
        headers=headers,
    )
    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    session = await anext(generator)
    try:
        first = await claim_next_job(session, worker_id="worker", lease_seconds=60)
        assert first is not None
        await fail_job(session, first, "temporary")
        # Make the retry immediately eligible rather than waiting for backoff.
        first.run_after = first.created_at
        await session.commit()
        second = await claim_next_job(session, worker_id="worker", lease_seconds=60)
        assert second is not None
        await fail_job(session, second, "permanent")
    finally:
        await generator.aclose()

    result = await client.get(f"/jobs/{created.json()['id']}", headers=headers)
    assert result.json()["status"] == "failed"
    assert result.json()["attempts"] == 2


@pytest.mark.asyncio
async def test_job_rejects_unknown_type(client: httpx.AsyncClient) -> None:
    headers, _ = await _register(client, "job-type@example.com")
    response = await client.post("/jobs", json={"type": "unknown.task"}, headers=headers)
    assert response.status_code == 422
