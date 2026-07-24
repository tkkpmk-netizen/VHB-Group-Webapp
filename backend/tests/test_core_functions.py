"""Core 1 database transfers and Core 2 block document tests."""

import httpx
import pytest

from app.services.spreadsheets import export_entities, read_tabular


async def _register(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Core"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return {**auth, "X-Workspace-ID": workspace["id"]}


@pytest.mark.asyncio
async def test_document_crud_and_optimistic_version(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "documents@example.com")
    database = await client.post(
        "/databases", json={"name": "Products", "icon": "database"}, headers=headers
    )
    entity = await client.post(
        f"/databases/{database.json()['id']}/entities",
        json={"name": "Export carton", "data": {}},
        headers=headers,
    )
    created = await client.post(
        "/documents",
        json={
            "title": "Product brief",
            "icon": "file-alt",
            "source_entity_id": entity.json()["id"],
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    document = created.json()
    assert document["version"] == 1
    assert document["icon"] == "file-alt"
    assert document["source_entity_id"] == entity.json()["id"]

    saved = await client.put(
        f"/documents/{document['id']}/content",
        json={
            "expected_version": 1,
            "content": [{"type": "heading", "content": "Overview"}],
        },
        headers=headers,
    )
    assert saved.status_code == 200
    assert saved.json()["version"] == 2

    conflict = await client.put(
        f"/documents/{document['id']}/content",
        json={"expected_version": 1, "content": []},
        headers=headers,
    )
    assert conflict.status_code == 409
    other = await client.post(
        "/documents",
        json={"title": "Workspace notes"},
        headers=headers,
    )
    assert other.status_code == 201
    listed = await client.get("/documents", headers=headers)
    assert {item["title"] for item in listed.json()} == {
        "Product brief",
        "Workspace notes",
    }
    linked = await client.get(
        "/documents",
        params={"source_entity_id": entity.json()["id"]},
        headers=headers,
    )
    assert linked.status_code == 200
    assert [item["title"] for item in linked.json()] == ["Product brief"]


@pytest.mark.asyncio
async def test_documents_are_workspace_isolated(client: httpx.AsyncClient) -> None:
    headers_a = await _register(client, "docs-a@example.com")
    headers_b = await _register(client, "docs-b@example.com")
    document = await client.post("/documents", json={"title": "Private"}, headers=headers_a)
    response = await client.get(f"/documents/{document.json()['id']}", headers=headers_b)
    assert response.status_code == 404
    database = await client.post("/databases", json={"name": "A"}, headers=headers_a)
    entity = await client.post(
        f"/databases/{database.json()['id']}/entities",
        json={"name": "A entity", "data": {}},
        headers=headers_a,
    )
    cross_workspace = await client.post(
        "/documents",
        json={"title": "Forbidden", "source_entity_id": entity.json()["id"]},
        headers=headers_b,
    )
    assert cross_workspace.status_code == 404


@pytest.mark.asyncio
async def test_export_job_contract(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "exports@example.com")
    database = await client.post("/databases", json={"name": "Orders"}, headers=headers)
    response = await client.post(
        f"/databases/{database.json()['id']}/exports",
        json={"format": "xlsx"},
        headers=headers,
    )
    assert response.status_code == 202, response.text
    assert response.json()["job"]["type"] == "database.export"


def test_csv_xlsx_roundtrip_has_headers_and_rows() -> None:
    class Item:
        def __init__(self, name: str, identifier: str) -> None:
            self.name = name
            self.id = identifier

    class Record:
        def __init__(self, data: dict[str, object]) -> None:
            self.data = data

    fields = [Item("Name", "name"), Item("Amount", "amount")]
    entities = [Record({"name": "Acme", "amount": 120})]
    for file_format in ("csv", "xlsx"):
        data, _ = export_entities(fields, entities, file_format)  # type: ignore[arg-type]
        headers, records = read_tabular(data, file_format)
        assert headers == ["Name", "Amount"]
        assert records[0] == ["Acme", "120"] if file_format == "csv" else ["Acme", 120]


def test_export_serializes_complex_json_cells_and_escapes_formulas() -> None:
    class Item:
        def __init__(self, name: str, identifier: str) -> None:
            self.name = name
            self.id = identifier

    class Record:
        def __init__(self, data: dict[str, object]) -> None:
            self.data = data

    fields = [
        Item("Range", "range"),
        Item("Tags", "tags"),
        Item("Metadata", "metadata"),
        Item("Unsafe", "unsafe"),
    ]
    entities = [
        Record(
            {
                "range": {"start": "2026-12-03", "end": "2026-12-31"},
                "tags": ["Design", "Ready"],
                "metadata": {"label": "Hà Nội", "active": True},
                "unsafe": "=2+2",
            }
        )
    ]

    for file_format in ("csv", "xlsx"):
        data, _ = export_entities(fields, entities, file_format)  # type: ignore[arg-type]
        _, records = read_tabular(data, file_format)
        assert records[0] == [
            "2026-12-03 → 2026-12-31",
            "Design, Ready",
            '{"active":true,"label":"Hà Nội"}',
            "'=2+2",
        ]
