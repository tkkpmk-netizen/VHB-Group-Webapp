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
async def test_relation_two_way(client: httpx.AsyncClient) -> None:
    headers, db_a = await _setup(client)
    rb = await client.post("/databases", json={"name": "Orders"}, headers=headers)
    db_b = rb.json()["id"]

    # relation A -> B, two-way (auto mirror on B)
    rf = await client.post(
        f"/databases/{db_a}/fields",
        json={
            "name": "Orders",
            "type": "relation",
            "options": {"target_database_id": db_b, "two_way": True},
        },
        headers=headers,
    )
    assert rf.status_code == 201, rf.text
    rel_field = rf.json()["id"]

    fb = await client.get(f"/databases/{db_b}/fields", headers=headers)
    mirrors = [f for f in fb.json() if f["type"] == "relation"]
    assert len(mirrors) == 1
    mirror_field = mirrors[0]["id"]

    rbrow = await client.post(f"/databases/{db_b}/rows", json={"data": {}}, headers=headers)
    b_row = rbrow.json()["id"]
    arow = await client.post(
        f"/databases/{db_a}/rows",
        json={"data": {rel_field: [b_row]}},
        headers=headers,
    )
    assert arow.status_code == 201, arow.text
    a_row = arow.json()["id"]
    assert arow.json()["data"][rel_field] == [b_row]

    la = await client.get(f"/databases/{db_a}/rows", headers=headers)
    assert la.json()[0]["data"][rel_field] == [b_row]
    # mirror side auto-shows the back-link
    lb = await client.get(f"/databases/{db_b}/rows", headers=headers)
    assert lb.json()[0]["data"][mirror_field] == [a_row]


@pytest.mark.asyncio
async def test_rollup_sum_and_count(client: httpx.AsyncClient) -> None:
    headers, db_a = await _setup(client)
    rb = await client.post("/databases", json={"name": "Orders"}, headers=headers)
    db_b = rb.json()["id"]
    amt = await _add_field(client, headers, db_b, "Amount", "number")

    rf = await client.post(
        f"/databases/{db_a}/fields",
        json={
            "name": "Orders",
            "type": "relation",
            "options": {"target_database_id": db_b},
        },
        headers=headers,
    )
    rel = rf.json()["id"]
    ru = await client.post(
        f"/databases/{db_a}/fields",
        json={
            "name": "Total",
            "type": "rollup",
            "options": {
                "relation_field_id": rel,
                "target_field_id": amt,
                "function": "sum",
            },
        },
        headers=headers,
    )
    rollup = ru.json()["id"]

    b1 = (
        await client.post(
            f"/databases/{db_b}/rows", json={"data": {amt: 100}}, headers=headers
        )
    ).json()["id"]
    b2 = (
        await client.post(
            f"/databases/{db_b}/rows", json={"data": {amt: 250}}, headers=headers
        )
    ).json()["id"]

    a = await client.post(
        f"/databases/{db_a}/rows",
        json={"data": {rel: [b1, b2]}},
        headers=headers,
    )
    assert a.json()["data"][rollup] == 350  # sum

    await client.patch(
        f"/fields/{rollup}",
        json={
            "name": "Total",
            "options": {
                "relation_field_id": rel,
                "target_field_id": amt,
                "function": "count",
            },
        },
        headers=headers,
    )
    la = await client.get(f"/databases/{db_a}/rows", headers=headers)
    assert la.json()[0]["data"][rollup] == 2  # count


@pytest.mark.asyncio
async def test_formula(client: httpx.AsyncClient) -> None:
    headers, db = await _setup(client)
    price = await _add_field(client, headers, db, "Price", "number")
    qty = await _add_field(client, headers, db, "Qty", "number")
    ff = await client.post(
        f"/databases/{db}/fields",
        json={
            "name": "Total",
            "type": "formula",
            "options": {"expression": 'prop("Price") * prop("Qty")'},
        },
        headers=headers,
    )
    total = ff.json()["id"]
    r = await client.post(
        f"/databases/{db}/rows",
        json={"data": {price: 10, qty: 3}},
        headers=headers,
    )
    assert r.json()["data"][total] == 30

    # sandbox: dangerous expression yields None, never executes
    bad = await client.post(
        f"/databases/{db}/fields",
        json={
            "name": "Bad",
            "type": "formula",
            "options": {"expression": "__import__('os').getcwd()"},
        },
        headers=headers,
    )
    bad_id = bad.json()["id"]
    rows = await client.get(f"/databases/{db}/rows", headers=headers)
    assert rows.json()[0]["data"][bad_id] is None


@pytest.mark.asyncio
async def test_engine_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    headers_a, db_a = await _setup(client, "a@example.com")
    headers_b, _ = await _setup(client, "b@example.com")

    # B cannot read A's fields
    r = await client.get(f"/databases/{db_a}/fields", headers=headers_b)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_system_and_people_progress_fields(client: httpx.AsyncClient) -> None:
    headers, db = await _setup(client)
    people_f = await _add_field(client, headers, db, "Owners", "people")
    prog_f = await _add_field(client, headers, db, "Done", "progress")
    ct_f = await _add_field(client, headers, db, "Created", "created_time")
    cb_f = await _add_field(client, headers, db, "Creator", "created_by")
    eb_f = await _add_field(client, headers, db, "Editor", "last_edited_by")

    me = (await client.get("/auth/me", headers=headers)).json()["id"]

    r = await client.post(
        f"/databases/{db}/rows",
        json={"data": {people_f: [me], prog_f: 150}},  # 150 clamps to 100
        headers=headers,
    )
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["data"][people_f] == [me]
    assert row["data"][prog_f] == 100  # clamped
    assert row["data"][cb_f] == me  # created_by stamped server-side
    assert row["data"][eb_f] == me
    assert row["data"][ct_f]  # created_time injected (non-empty ISO string)

    # progress must be numeric
    bad = await client.post(
        f"/databases/{db}/rows", json={"data": {prog_f: "x"}}, headers=headers
    )
    assert bad.status_code == 422

    # members endpoint lists the creator
    members = await client.get("/workspaces/me/members", headers=headers)
    assert members.status_code == 200
    assert any(m["id"] == me for m in members.json())


@pytest.mark.asyncio
async def test_views_crud_and_persist(client: httpx.AsyncClient) -> None:
    headers, db = await _setup(client)

    # GET lazily seeds a default Table view.
    r = await client.get(f"/databases/{db}/views", headers=headers)
    assert r.status_code == 200
    views = r.json()
    assert len(views) == 1 and views[0]["type"] == "table"

    # Create a Board view with config.
    r = await client.post(
        f"/databases/{db}/views",
        json={"name": "Pipeline", "type": "board", "config": {"board_field": "x"}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    board = r.json()
    assert board["type"] == "board" and board["config"]["board_field"] == "x"

    # Patch config persists.
    r = await client.patch(
        f"/views/{board['id']}",
        json={"config": {"sorts": [{"fieldId": "a", "dir": "asc"}]}},
        headers=headers,
    )
    assert r.json()["config"]["sorts"][0]["dir"] == "asc"

    # Now two views; delete the board one.
    r = await client.delete(f"/views/{board['id']}", headers=headers)
    assert r.status_code == 204
    r = await client.get(f"/databases/{db}/views", headers=headers)
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_views_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    headers_a, db_a = await _setup(client, "va@example.com")
    headers_b, _ = await _setup(client, "vb@example.com")
    r = await client.get(f"/databases/{db_a}/views", headers=headers_b)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_list_rows_system_plus_relation_no_500(client: httpx.AsyncClient) -> None:
    # Regression: created_time + a relation/rollup (whose inject autoflushes and
    # expires updated_at) used to 500 the list endpoint via an async lazy-load.
    headers, crm = await _setup(client)
    r = await client.post("/databases", json={"name": "Orders"}, headers=headers)
    orders = r.json()["id"]
    ct = await _add_field(client, headers, crm, "Created", "created_time")
    rel = await _add_field(
        client, headers, crm, "Order", "relation", {"target_database_id": orders}
    )
    await _add_field(
        client, headers, crm, "Cnt", "rollup",
        {"relation_field_id": rel, "function": "count"},
    )
    await client.post(f"/databases/{crm}/rows", json={"data": {}}, headers=headers)
    r = await client.get(f"/databases/{crm}/rows", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()[0]["data"][ct]  # created_time present, no crash
