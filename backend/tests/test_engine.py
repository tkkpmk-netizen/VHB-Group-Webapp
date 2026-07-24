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
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {name_f: "Acme", amt_f: 100}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    entity_id = r.json()["id"]
    assert r.json()["data"][name_f] == "Acme"

    # inline update one cell
    r = await client.patch(
        f"/entities/{entity_id}",
        json={"name": "Test entity", "data": {amt_f: 250}},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["data"][amt_f] == 250
    assert r.json()["data"][name_f] == "Acme"  # untouched cell preserved

    # delete
    r = await client.delete(f"/entities/{entity_id}", headers=headers)
    assert r.status_code == 204
    r = await client.get(f"/databases/{db_id}/entities", headers=headers)
    assert r.json() == []


@pytest.mark.asyncio
async def test_sub_item_tree_loads_relatives_outside_the_current_page(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "subitems@example.com")
    enabled = await client.post(
        f"/databases/{db_id}/sub-items",
        headers=headers,
    )
    assert enabled.status_code == 201, enabled.text
    sub_item_field = enabled.json()["sub_item_field"]
    parent_field = enabled.json()["parent_field"]

    parent = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Parent", "data": {}},
        headers=headers,
    )
    child = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Child", "data": {}},
        headers=headers,
    )
    linked = await client.patch(
        f"/entities/{parent.json()['id']}",
        json={"data": {sub_item_field: [child.json()["id"]]}},
        headers=headers,
    )
    assert linked.status_code == 200, linked.text

    first_page = await client.post(
        f"/databases/{db_id}/entities/query",
        json={"page": 1, "page_size": 1},
        headers=headers,
    )
    assert [item["id"] for item in first_page.json()["items"]] == [parent.json()["id"]]

    tree = await client.post(
        f"/databases/{db_id}/entities/sub-item-tree",
        json={"entity_ids": [parent.json()["id"]]},
        headers=headers,
    )
    assert tree.status_code == 200, tree.text
    by_id = {item["id"]: item for item in tree.json()}
    assert set(by_id) == {parent.json()["id"], child.json()["id"]}
    assert by_id[parent.json()["id"]]["data"][sub_item_field] == [child.json()["id"]]
    assert by_id[child.json()["id"]]["data"][parent_field] == [parent.json()["id"]]

    reverse_tree = await client.post(
        f"/databases/{db_id}/entities/sub-item-tree",
        json={"entity_ids": [child.json()["id"]]},
        headers=headers,
    )
    assert {item["id"] for item in reverse_tree.json()} == set(by_id)

    other_parent = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Other parent", "data": {}},
        headers=headers,
    )
    reparented = await client.patch(
        f"/entities/{other_parent.json()['id']}",
        json={"data": {sub_item_field: [child.json()["id"]]}},
        headers=headers,
    )
    assert reparented.status_code == 200, reparented.text
    all_entities = await client.get(f"/databases/{db_id}/entities", headers=headers)
    after_owner_reparent = {item["id"]: item for item in all_entities.json()}
    assert after_owner_reparent[parent.json()["id"]]["data"][sub_item_field] == []
    assert after_owner_reparent[other_parent.json()["id"]]["data"][sub_item_field] == [
        child.json()["id"]
    ]
    assert after_owner_reparent[child.json()["id"]]["data"][parent_field] == [
        other_parent.json()["id"]
    ]

    single_parent = await client.patch(
        f"/entities/{child.json()['id']}",
        json={
            "data": {
                parent_field: [
                    parent.json()["id"],
                    other_parent.json()["id"],
                ]
            }
        },
        headers=headers,
    )
    assert single_parent.status_code == 200, single_parent.text
    assert single_parent.json()["data"][parent_field] == [parent.json()["id"]]
    final_entities = await client.get(f"/databases/{db_id}/entities", headers=headers)
    after_mirror_reparent = {item["id"]: item for item in final_entities.json()}
    assert after_mirror_reparent[parent.json()["id"]]["data"][sub_item_field] == [
        child.json()["id"]
    ]
    assert after_mirror_reparent[other_parent.json()["id"]]["data"][sub_item_field] == []


@pytest.mark.asyncio
async def test_entity_name_is_required_unique_and_uid_is_generated(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "identity@example.com")
    missing = await client.post(f"/databases/{db_id}/entities", json={"data": {}}, headers=headers)
    assert missing.status_code == 422

    first = await client.post(
        f"/databases/{db_id}/entities", json={"name": "Acme", "data": {}}, headers=headers
    )
    second = await client.post(
        f"/databases/{db_id}/entities", json={"name": "Acme", "data": {}}, headers=headers
    )
    assert first.status_code == second.status_code == 201
    assert first.json()["name"] == "Acme"
    assert second.json()["name"] == "Acme 2"
    assert first.json()["uid"] != second.json()["uid"]
    assert first.json()["uid"] == "1"
    assert second.json()["uid"] == "2"


@pytest.mark.asyncio
async def test_bulk_create_rows(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    await _add_field(client, headers, db_id, "Name", "text")

    r = await client.post(
        f"/databases/{db_id}/entities/bulk",
        json={"names": ["A", "B", "C", "D", "E"]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert len(r.json()) == 5
    seqs = sorted(row["seq"] for row in r.json())
    assert seqs == [1, 2, 3, 4, 5]  # sequential seq assigned

    r = await client.get(f"/databases/{db_id}/entities", headers=headers)
    assert len(r.json()) == 5

    # count bounds enforced (max 100)
    r = await client.post(
        f"/databases/{db_id}/entities/bulk",
        json={"names": [str(index) for index in range(101)]},
        headers=headers,
    )
    assert r.status_code == 422


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
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {amt_f: "abc"}},
        headers=headers,
    )
    assert r.status_code == 422

    # select rejects unknown option
    r = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {sel_f: "ghost"}},
        headers=headers,
    )
    assert r.status_code == 422

    # valid select accepted
    r = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {sel_f: "open"}},
        headers=headers,
    )
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_adding_field_keeps_existing_rows(client: httpx.AsyncClient) -> None:
    headers, db_id = await _setup(client)
    name_f = await _add_field(client, headers, db_id, "Name", "text")
    r = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {name_f: "Acme"}},
        headers=headers,
    )
    entity_id = r.json()["id"]

    # add a new field afterwards
    new_f = await _add_field(client, headers, db_id, "Amount", "number")

    r = await client.get(f"/databases/{db_id}/entities", headers=headers)
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["id"] == entity_id
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
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {rating_f: 9}},
        headers=headers,
    )
    assert r.status_code == 422

    # valid rating + multi_select + status
    r = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {rating_f: 4, tags_f: ["a", "b"], status_f: "todo"}},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    assert r.json()["data"][tags_f] == ["a", "b"]

    # multi_select with invalid option rejected
    r = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Test entity", "data": {tags_f: ["x"]}},
        headers=headers,
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
async def test_field_type_conversion_previews_maps_and_clears_cells(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "field-conversion@example.com")
    field_id = await _add_field(client, headers, db_id, "Imported amount", "text")
    for name, value in [
        ("Convertible", "12.5"),
        ("Invalid", "not a number"),
        ("Empty", None),
    ]:
        response = await client.post(
            f"/databases/{db_id}/entities",
            json={
                "name": name,
                "data": {} if value is None else {field_id: value},
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text

    preview = await client.post(
        f"/fields/{field_id}/convert-type",
        json={"target_type": "number", "dry_run": True},
        headers=headers,
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["converted_cells"] == 1
    assert preview.json()["cleared_cells"] == 1
    assert preview.json()["empty_cells"] == 1
    assert preview.json()["field"] is None

    unchanged_fields = await client.get(
        f"/databases/{db_id}/fields", headers=headers
    )
    unchanged_field = next(
        field for field in unchanged_fields.json() if field["id"] == field_id
    )
    assert unchanged_field["type"] == "text"
    unchanged_entities = await client.get(
        f"/databases/{db_id}/entities", headers=headers
    )
    unchanged_by_name = {entity["name"]: entity for entity in unchanged_entities.json()}
    assert unchanged_by_name["Invalid"]["data"][field_id] == "not a number"

    applied = await client.post(
        f"/fields/{field_id}/convert-type",
        json={"target_type": "number", "dry_run": False},
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["field"]["type"] == "number"
    converted_entities = await client.get(
        f"/databases/{db_id}/entities", headers=headers
    )
    converted_by_name = {entity["name"]: entity for entity in converted_entities.json()}
    assert converted_by_name["Convertible"]["data"][field_id] == 12.5
    assert field_id not in converted_by_name["Invalid"]["data"]
    assert field_id not in converted_by_name["Empty"]["data"]

    select_preview = await client.post(
        f"/fields/{field_id}/convert-type",
        json={"target_type": "select", "dry_run": True},
        headers=headers,
    )
    assert select_preview.status_code == 200, select_preview.text
    assert select_preview.json()["generated_choices"] == 1
    assert select_preview.json()["converted_cells"] == 1

    select_applied = await client.post(
        f"/fields/{field_id}/convert-type",
        json={"target_type": "select", "dry_run": False},
        headers=headers,
    )
    assert select_applied.status_code == 200, select_applied.text
    converted_field = select_applied.json()["field"]
    assert converted_field["type"] == "select"
    assert [choice["label"] for choice in converted_field["options"]["choices"]] == [
        "12.5"
    ]


@pytest.mark.asyncio
async def test_field_type_conversion_rejects_system_fields(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "field-conversion-system@example.com")
    fields = await client.get(f"/databases/{db_id}/fields", headers=headers)
    uid_field = next(field for field in fields.json() if field["type"] == "unique_id")

    response = await client.post(
        f"/fields/{uid_field['id']}/convert-type",
        json={"target_type": "text", "dry_run": True},
        headers=headers,
    )
    assert response.status_code == 409


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

    rbrow = await client.post(
        f"/databases/{db_b}/entities", json={"name": "Test entity", "data": {}}, headers=headers
    )
    b_row = rbrow.json()["id"]
    arow = await client.post(
        f"/databases/{db_a}/entities",
        json={"name": "Test entity", "data": {rel_field: [b_row]}},
        headers=headers,
    )
    assert arow.status_code == 201, arow.text
    a_row = arow.json()["id"]
    assert arow.json()["data"][rel_field] == [b_row]

    la = await client.get(f"/databases/{db_a}/entities", headers=headers)
    assert la.json()[0]["data"][rel_field] == [b_row]
    # mirror side auto-shows the back-link
    lb = await client.get(f"/databases/{db_b}/entities", headers=headers)
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
            f"/databases/{db_b}/entities",
            json={"name": "Test entity", "data": {amt: 100}},
            headers=headers,
        )
    ).json()["id"]
    b2 = (
        await client.post(
            f"/databases/{db_b}/entities",
            json={"name": "Test entity", "data": {amt: 250}},
            headers=headers,
        )
    ).json()["id"]

    a = await client.post(
        f"/databases/{db_a}/entities",
        json={"name": "Test entity", "data": {rel: [b1, b2]}},
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
    la = await client.get(f"/databases/{db_a}/entities", headers=headers)
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
        f"/databases/{db}/entities",
        json={"name": "Test entity", "data": {price: 10, qty: 3}},
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
    rows = await client.get(f"/databases/{db}/entities", headers=headers)
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
        f"/databases/{db}/entities",
        json={"name": "Test entity", "data": {people_f: [me], prog_f: 150}},  # 150 clamps to 100
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
        f"/databases/{db}/entities",
        json={"name": "Test entity", "data": {prog_f: "x"}},
        headers=headers,
    )
    assert bad.status_code == 422

    # members endpoint lists the creator
    members = await client.get("/workspaces/me/members", headers=headers)
    assert members.status_code == 200
    assert any(m["id"] == me for m in members.json())


@pytest.mark.asyncio
async def test_layouts_crud_and_persist(client: httpx.AsyncClient) -> None:
    headers, db = await _setup(client)

    # GET lazily seeds a default Table layout.
    r = await client.get(f"/databases/{db}/layouts", headers=headers)
    assert r.status_code == 200
    layouts = r.json()
    assert len(layouts) == 1 and layouts[0]["type"] == "table"

    # Create a Board layout with config.
    r = await client.post(
        f"/databases/{db}/layouts",
        json={
            "name": "Pipeline",
            "type": "board",
            "icon": "columns",
            "config": {"board_field": "x"},
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    board = r.json()
    assert board["type"] == "board" and board["config"]["board_field"] == "x"
    assert board["icon"] == "columns"

    # Patch config persists.
    r = await client.patch(
        f"/layouts/{board['id']}",
        json={"config": {"sorts": [{"fieldId": "a", "dir": "asc"}]}},
        headers=headers,
    )
    assert r.json()["config"]["sorts"][0]["dir"] == "asc"

    # Now two layouts; delete the board one.
    r = await client.delete(f"/layouts/{board['id']}", headers=headers)
    assert r.status_code == 204
    r = await client.get(f"/databases/{db}/layouts", headers=headers)
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_layouts_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    headers_a, db_a = await _setup(client, "va@example.com")
    headers_b, _ = await _setup(client, "vb@example.com")
    r = await client.get(f"/databases/{db_a}/layouts", headers=headers_b)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_relation_drops_rows_outside_target_database(client: httpx.AsyncClient) -> None:
    """Links may only point at rows of the field's target database — foreign
    workspace rows (or wrong-database rows) are silently dropped."""
    headers_a, db_a = await _setup(client, "rela@example.com")
    headers_b, db_b = await _setup(client, "relb@example.com")

    foreign = await client.post(
        f"/databases/{db_b}/entities", json={"name": "Test entity", "data": {}}, headers=headers_b
    )
    foreign_row = foreign.json()["id"]

    target = await client.post("/databases", json={"name": "Targets"}, headers=headers_a)
    db_target = target.json()["id"]
    rel = await _add_field(
        client, headers_a, db_a, "Rel", "relation", {"target_database_id": db_target}
    )
    own = await client.post(
        f"/databases/{db_target}/entities",
        json={"name": "Test entity", "data": {}},
        headers=headers_a,
    )
    own_row = own.json()["id"]

    created = await client.post(
        f"/databases/{db_a}/entities",
        json={"name": "Test entity", "data": {rel: [foreign_row, own_row]}},
        headers=headers_a,
    )
    assert created.status_code == 201, created.text
    assert created.json()["data"][rel] == [own_row]  # foreign row dropped


@pytest.mark.asyncio
async def test_update_relation_field_preserves_structural_options(
    client: httpx.AsyncClient,
) -> None:
    headers, db_a = await _setup(client, "structural@example.com")
    rb = await client.post("/databases", json={"name": "Orders"}, headers=headers)
    db_b = rb.json()["id"]
    rf = await client.post(
        f"/databases/{db_a}/fields",
        json={
            "name": "Orders",
            "type": "relation",
            "options": {"target_database_id": db_b, "two_way": True},
        },
        headers=headers,
    )
    field = rf.json()
    r = await client.patch(
        f"/fields/{field['id']}",
        json={
            "options": {
                "target_database_id": "00000000-0000-0000-0000-000000000000",
                "mirror": True,
                "owner_field_id": "00000000-0000-0000-0000-000000000000",
                "display": "compact",
            }
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    options = r.json()["options"]
    assert options["target_database_id"] == db_b  # structural keys survive
    assert options["paired_field_id"] == field["options"]["paired_field_id"]
    assert "mirror" not in options  # cannot be injected either
    assert "owner_field_id" not in options
    assert options["display"] == "compact"  # display keys still editable
