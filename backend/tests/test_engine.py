"""Engine tests: fields, rows, validation, isolation (requires Postgres)."""

import httpx
import pytest


async def _setup(client: httpx.AsyncClient, email: str = "a@example.com") -> tuple[dict, str]:
    r = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "T"},
    )
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/databases", json={"name": "CRM"}, headers=headers)
    return headers, r.json()["id"]


async def _add_field(client, headers, db_id, name, ftype, options=None):
    r = await client.post(
        f"/databases/{db_id}/fields",
        json={"name": name, "type": ftype, "options": options or {}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_fields_all_simple_types(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    for name, ftype in [
        ("Name", "text"),
        ("Amount", "number"),
        ("Done", "checkbox"),
        ("Due", "date"),
        ("Website", "url"),
        ("Email", "email"),
        ("Phone", "phone"),
    ]:
        await _add_field(client, headers, db_id, name, ftype)
    r = await client.get(f"/databases/{db_id}/fields", headers=headers)
    assert len(r.json()) == 9  # 7 added + default ID + Name fields


@pytest.mark.asyncio
async def test_row_crud_and_inline_update(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    name_f = await _add_field(client, headers, db_id, "Name", "text")
    amt_f = await _add_field(client, headers, db_id, "Amount", "number")

    # create row
    r = await client.post(
        f"/databases/{db_id}/rows",
        json={"data": {name_f: "Acme", amt_f: 100}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    row_id = r.json()["id"]
    assert r.json()["data"][name_f] == "Acme"

    # inline update one cell
    r = await client.patch(
        f"/rows/{row_id}", json={"data": {amt_f: 250}}, headers=headers
    )
    assert r.status_code == 200
    assert r.json()["data"][amt_f] == 250
    assert r.json()["data"][name_f] == "Acme"  # untouched cell preserved

    # delete
    r = await client.delete(f"/rows/{row_id}", headers=headers)
    assert r.status_code == 204
    r = await client.get(f"/databases/{db_id}/rows", headers=headers)
    assert r.json() == []


@pytest.mark.asyncio
async def test_value_validation(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    amt_f = await _add_field(client, headers, db_id, "Amount", "number")
    sel_f = await _add_field(
        client,
        headers,
        db_id,
        "Status",
        "select",
        {"choices": [{"id": "open", "label": "Open"}]},
    )

    # number rejects string
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {amt_f: "abc"}}, headers=headers
    )
    assert r.status_code == 422

    # select rejects unknown option
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {sel_f: "ghost"}}, headers=headers
    )
    assert r.status_code == 422

    # valid select accepted
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {sel_f: "open"}}, headers=headers
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_adding_field_keeps_existing_rows(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    name_f = await _add_field(client, headers, db_id, "Name", "text")
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {name_f: "Acme"}}, headers=headers
    )
    row_id = r.json()["id"]

    # add a new field afterwards
    new_f = await _add_field(client, headers, db_id, "Amount", "number")

    r = await client.get(f"/databases/{db_id}/rows", headers=headers)
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["id"] == row_id
    assert rows[0]["data"][name_f] == "Acme"  # old data intact
    assert new_f not in rows[0]["data"]  # new field empty for old row


@pytest.mark.asyncio
async def test_new_e1_field_types(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    rating_f = await _add_field(client, headers, db_id, "Stars", "rating")
    tags_f = await _add_field(
        client,
        headers,
        db_id,
        "Tags",
        "multi_select",
        {"choices": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]},
    )
    status_f = await _add_field(
        client,
        headers,
        db_id,
        "Status",
        "status",
        {"choices": [{"id": "todo", "label": "To-do"}]},
    )

    # rating out of range rejected
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {rating_f: 9}}, headers=headers
    )
    assert r.status_code == 422

    # valid rating + multi_select + status
    r = await client.post(
        f"/databases/{db_id}/rows",
        json={"data": {rating_f: 4, tags_f: ["a", "b"], status_f: "todo"}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["data"][tags_f] == ["a", "b"]

    # multi_select with invalid option rejected
    r = await client.post(
        f"/databases/{db_id}/rows", json={"data": {tags_f: ["x"]}}, headers=headers
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_update_field_rename_and_options(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    fid = await _add_field(client, headers, db_id, "Amt", "number", {"format": "plain"})

    r = await client.patch(
        f"/fields/{fid}",
        json={"name": "Revenue", "options": {"format": "currency", "currency_code": "VND"}},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Revenue"
    assert body["options"]["format"] == "currency"
    assert body["type"] == "number"  # type unchanged


@pytest.mark.asyncio
async def test_engine_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    headers_a, db_a = await _setup(client, "a@example.com")
    headers_b, _ = await _setup(client, "b@example.com")

    # B cannot read A's fields
    r = await client.get(f"/databases/{db_a}/fields", headers=headers_b)
    assert r.status_code == 404
