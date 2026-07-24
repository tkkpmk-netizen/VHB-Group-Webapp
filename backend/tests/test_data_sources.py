"""DataSource CRUD, entity stamping, filtering, and import integration tests."""

from collections.abc import AsyncGenerator

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.main import app
from app.services.jobs import claim_next_job, complete_job
from app.services.storage import get_object_storage
from app.worker import execute_job


class FakeStorage:
    def __init__(self) -> None:
        self.sizes: dict[str, int] = {}
        self.objects: dict[str, bytes] = {}

    async def presign_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str:
        return f"https://storage.test/upload/{key}?type={content_type}"

    async def presign_download(self, key: str, *, filename: str, expires_seconds: int) -> str:
        return f"https://storage.test/download/{key}?filename={filename}"

    async def object_size(self, key: str) -> int:
        return self.sizes[key]

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def get_bytes(self, key: str) -> bytes:
        return self.objects[key]

    async def put_bytes(self, key: str, data: bytes, *, content_type: str) -> None:
        self.objects[key] = data
        self.sizes[key] = len(data)


async def _setup(client: httpx.AsyncClient, email: str = "ds@example.com") -> tuple[dict, str]:
    r = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "DS"},
    )
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/databases", json={"name": "Inventory"}, headers=headers)
    return headers, r.json()["id"]


@pytest.mark.asyncio
async def test_database_create_has_primary_data_source(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    r = await client.get(f"/databases/{db_id}/data-sources", headers=headers)
    assert r.status_code == 200
    sources = r.json()
    assert len(sources) == 1
    assert sources[0]["name"] == "Primary"
    assert sources[0]["is_primary"] is True
    assert sources[0]["kind"] == "manual"


@pytest.mark.asyncio
async def test_manual_entity_defaults_to_primary_source(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    primary = (await client.get(f"/databases/{db_id}/data-sources", headers=headers)).json()[0]
    r = await client.post(
        f"/databases/{db_id}/entities", json={"name": "Test entity", "data": {}}, headers=headers
    )
    assert r.status_code == 201, r.text
    assert r.json()["data_source_id"] == primary["id"]

    bulk = await client.post(
        f"/databases/{db_id}/entities/bulk", json={"names": ["A", "B"]}, headers=headers
    )
    assert all(item["data_source_id"] == primary["id"] for item in bulk.json())


@pytest.mark.asyncio
async def test_entity_explicit_data_source_id(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    other_db = await client.post("/databases", json={"name": "Other"}, headers=headers)
    other_db_id = other_db.json()["id"]
    other_source = (
        await client.get(f"/databases/{other_db_id}/data-sources", headers=headers)
    ).json()[0]

    created = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {}, "data_source_id": other_source["id"]},
        headers=headers,
    )
    assert created.status_code == 404

    own_source = await client.post(
        f"/databases/{db_id}/data-sources",
        json={"name": "Manual batch 2"},
        headers=headers,
    )
    assert own_source.status_code == 201, own_source.text
    ok = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {}, "data_source_id": own_source.json()["id"]},
        headers=headers,
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["data_source_id"] == own_source.json()["id"]


@pytest.mark.asyncio
async def test_data_source_rename_and_order(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    created = await client.post(
        f"/databases/{db_id}/data-sources", json={"name": "Batch A"}, headers=headers
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["id"]

    renamed = await client.patch(
        f"/data-sources/{source_id}", json={"name": "Batch A (renamed)"}, headers=headers
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Batch A (renamed)"

    sources = await client.get(f"/databases/{db_id}/data-sources", headers=headers)
    assert [s["name"] for s in sources.json()] == ["Primary", "Batch A (renamed)"]


@pytest.mark.asyncio
async def test_delete_primary_data_source_rejected(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    primary = (await client.get(f"/databases/{db_id}/data-sources", headers=headers)).json()[0]
    r = await client.delete(f"/data-sources/{primary['id']}", headers=headers)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_data_source_blocked_while_nonempty(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    source = await client.post(
        f"/databases/{db_id}/data-sources", json={"name": "Batch B"}, headers=headers
    )
    source_id = source.json()["id"]
    entity = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {}, "data_source_id": source_id},
        headers=headers,
    )
    assert entity.status_code == 201

    blocked = await client.delete(f"/data-sources/{source_id}", headers=headers)
    assert blocked.status_code == 409

    await client.delete(f"/entities/{entity.json()['id']}", headers=headers)
    freed = await client.delete(f"/data-sources/{source_id}", headers=headers)
    assert freed.status_code == 204


@pytest.mark.asyncio
async def test_filter_entities_by_data_source_id(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    primary = (await client.get(f"/databases/{db_id}/data-sources", headers=headers)).json()[0]
    other = await client.post(
        f"/databases/{db_id}/data-sources", json={"name": "Batch C"}, headers=headers
    )
    other_id = other.json()["id"]

    await client.post(
        f"/databases/{db_id}/entities", json={"name": "Test entity", "data": {}}, headers=headers
    )
    await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {}, "data_source_id": other_id},
        headers=headers,
    )

    listed = await client.get(
        f"/databases/{db_id}/entities", params={"data_source_id": other_id}, headers=headers
    )
    assert len(listed.json()) == 1
    assert listed.json()[0]["data_source_id"] == other_id

    id_filter = {"field_id": "data_source_id", "operator": "eq", "value": primary["id"]}
    queried = await client.post(
        f"/databases/{db_id}/entities/query",
        json={"filters": [id_filter]},
        headers=headers,
    )
    assert queried.json()["total"] == 1
    assert queried.json()["items"][0]["data_source_id"] == primary["id"]


@pytest.mark.asyncio
async def test_import_creates_data_source_and_stamps_entities(client: httpx.AsyncClient) -> None:
    storage = FakeStorage()
    app.dependency_overrides[get_object_storage] = lambda: storage
    headers, db_id = await _setup(client, "importer@example.com")

    await client.post(
        f"/databases/{db_id}/fields",
        json={"name": "Amount", "type": "number", "options": {}},
        headers=headers,
    )

    csv_bytes = b"Name,Amount\r\nAcme,120\r\n"
    upload = await client.post(
        "/assets/uploads",
        json={
            "filename": "orders.csv",
            "content_type": "text/csv",
            "size_bytes": len(csv_bytes),
        },
        headers=headers,
    )
    asset_id = upload.json()["asset"]["id"]
    upload_key = upload.json()["upload_url"].split("/upload/", 1)[1].split("?", 1)[0]
    storage.objects[upload_key] = csv_bytes
    storage.sizes[upload_key] = len(csv_bytes)
    completed = await client.post(f"/assets/{asset_id}/complete", headers=headers)
    assert completed.status_code == 200, completed.text

    imported = await client.post(
        f"/databases/{db_id}/imports",
        json={
            "asset_id": asset_id,
            "format": "csv",
            "mapping": {},
            "name_column": "Name",
            "create_missing_fields": True,
            "data_source_name": "Orders CSV",
        },
        headers=headers,
    )
    assert imported.status_code == 202, imported.text
    body = imported.json()
    assert body["data_source"]["name"] == "Orders CSV"
    assert body["data_source"]["kind"] == "imported"
    assert body["data_source"]["origin_job_id"] == body["job"]["id"]
    data_source_id = body["data_source"]["id"]

    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    session = await anext(generator)
    try:
        job = await claim_next_job(session, worker_id="import-test", lease_seconds=60)
        assert job is not None
        assert job.type == "database.import"
        result = await execute_job(session, job, storage)
        await complete_job(session, job, result)
    finally:
        await generator.aclose()

    entities = await client.get(
        f"/databases/{db_id}/entities", params={"data_source_id": data_source_id}, headers=headers
    )
    assert len(entities.json()) == 1
    assert entities.json()[0]["data_source_id"] == data_source_id
    assert entities.json()[0]["name"] == "Acme"
