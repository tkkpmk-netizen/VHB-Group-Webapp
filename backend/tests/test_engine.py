"""Engine tests: fields, rows, validation, isolation (requires Postgres)."""

import uuid

import httpx
import pytest

from app.models.field import Entity, Field, FieldType
from app.services.field_conversion import _as_number, build_field_conversion_plan


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
        ("Display name", "text"),
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
    name_f = await _add_field(client, headers, db_id, "Display name", "text")
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
async def test_database_history_restores_and_undoes_changes(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "history@example.com")
    amount = await _add_field(client, headers, db_id, "Amount", "number")
    created = await client.post(
        f"/databases/{db_id}/entities",
        json={"name": "Invoice", "data": {amount: 10}},
        headers=headers,
    )
    entity_id = created.json()["id"]
    updated = await client.patch(
        f"/entities/{entity_id}",
        json={"data": {amount: 25}},
        headers=headers,
    )
    assert updated.json()["data"][amount] == 25

    history = await client.get(
        f"/databases/{db_id}/history",
        headers=headers,
    )
    assert history.status_code == 200, history.text
    assert history.json()[0]["action"] == "entity.updated"

    undone = await client.post(
        f"/databases/{db_id}/history/undo",
        headers=headers,
    )
    assert undone.status_code == 200, undone.text
    rows = await client.get(f"/databases/{db_id}/entities", headers=headers)
    assert rows.json()[0]["data"][amount] == 10

    # The next undo reverses entity creation because the update revision is
    # already marked restored.
    undone_create = await client.post(
        f"/databases/{db_id}/history/undo",
        headers=headers,
    )
    assert undone_create.status_code == 200, undone_create.text
    rows = await client.get(f"/databases/{db_id}/entities", headers=headers)
    assert rows.json() == []


@pytest.mark.asyncio
async def test_database_history_restores_layout_with_active_view_preset(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "history-layout@example.com")
    layout = await client.post(
        f"/databases/{db_id}/layouts",
        json={"name": "Sales board", "type": "board"},
        headers=headers,
    )
    assert layout.status_code == 201, layout.text
    layout_id = layout.json()["id"]
    preset = await client.post(
        f"/layouts/{layout_id}/view-presets",
        json={
            "name": "Open deals",
            "filter": {"conj": "and", "rules": []},
            "sorts": [],
            "hide_empty": False,
        },
        headers=headers,
    )
    assert preset.status_code == 201, preset.text
    preset_id = preset.json()["id"]
    activated = await client.patch(
        f"/layouts/{layout_id}",
        json={"active_view_preset_id": preset_id},
        headers=headers,
    )
    assert activated.status_code == 200, activated.text
    deleted = await client.delete(f"/layouts/{layout_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text

    history = await client.get(f"/databases/{db_id}/history", headers=headers)
    deleted_revision = next(item for item in history.json() if item["action"] == "layout.deleted")
    restored = await client.post(
        f"/databases/{db_id}/history/{deleted_revision['id']}/restore",
        headers=headers,
    )
    assert restored.status_code == 200, restored.text
    layouts = await client.get(f"/databases/{db_id}/layouts", headers=headers)
    restored_layout = next(item for item in layouts.json() if item["id"] == layout_id)
    assert restored_layout["active_view_preset_id"] == preset_id
    presets = await client.get(
        f"/layouts/{layout_id}/view-presets",
        headers=headers,
    )
    assert presets.json()[0]["name"] == "Open deals"


@pytest.mark.asyncio
async def test_entity_id_review_query_pages_beyond_normal_load_limit(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "review-all@example.com")
    for batch in range(3):
        names = [f"Review {batch}-{index}" for index in range(100 if batch < 2 else 5)]
        created = await client.post(
            f"/databases/{db_id}/entities/bulk",
            json={"names": names},
            headers=headers,
        )
        assert created.status_code == 201, created.text
    ids: list[str] = []
    for page in range(1, 4):
        result = await client.post(
            f"/databases/{db_id}/entities/query",
            json={"page": page, "page_size": 100},
            headers=headers,
        )
        ids.extend(item["id"] for item in result.json()["items"])
    reviewed = await client.post(
        f"/databases/{db_id}/entities/by-ids",
        json={"entity_ids": ids, "page": 3, "page_size": 100},
        headers=headers,
    )
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["total"] == 205
    assert len(reviewed.json()["items"]) == 5


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
    name_f = await _add_field(client, headers, db_id, "Display name", "text")
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
    assert preview.json()["invalid_reason_counts"] == {
        "No numeric value could be extracted": 1
    }
    assert preview.json()["invalid_samples"] == [
        {
            "entity_id": preview.json()["invalid_entity_ids"][0],
            "entity_name": "Invalid",
            "value": "not a number",
            "reason": "No numeric value could be extracted",
        }
    ]

    unchanged_fields = await client.get(f"/databases/{db_id}/fields", headers=headers)
    unchanged_field = next(field for field in unchanged_fields.json() if field["id"] == field_id)
    assert unchanged_field["type"] == "text"
    unchanged_entities = await client.get(f"/databases/{db_id}/entities", headers=headers)
    unchanged_by_name = {entity["name"]: entity for entity in unchanged_entities.json()}
    assert unchanged_by_name["Invalid"]["data"][field_id] == "not a number"

    applied = await client.post(
        f"/fields/{field_id}/convert-type",
        json={
            "target_type": "number",
            "dry_run": False,
            "change_anyway": True,
        },
        headers=headers,
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["field"]["type"] == "number"
    converted_entities = await client.get(f"/databases/{db_id}/entities", headers=headers)
    converted_by_name = {entity["name"]: entity for entity in converted_entities.json()}
    assert converted_by_name["Convertible"]["data"][field_id] == 12.5
    wrong_format = next(
        entity for entity in converted_entities.json() if entity["name"].startswith("WRONG FORMAT ")
    )
    assert field_id not in wrong_format["data"]
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
    assert [choice["label"] for choice in converted_field["options"]["choices"]] == ["12.5"]


def test_text_to_select_generates_an_option_for_every_unique_value() -> None:
    database_id = uuid.uuid4()
    source_id = uuid.uuid4()
    field = Field(
        id=uuid.uuid4(),
        database_id=database_id,
        name="BRAND",
        type=FieldType.text,
        options={},
        order=2,
    )
    entities = [
        Entity(
            id=uuid.uuid4(),
            database_id=database_id,
            data_source_id=source_id,
            data={str(field.id): f"Brand {index}"},
            uid=str(index),
            name=f"Product {index}",
            seq=index,
            order=index,
        )
        for index in range(350)
    ]

    plan = build_field_conversion_plan(field, entities, FieldType.select, {})

    assert plan.generated_choices == 350
    assert plan.converted_cells == 350
    assert plan.cleared_cells == 0
    assert plan.invalid_reason_counts == {}
    assert {
        choice["label"] for choice in plan.target_options["choices"]
    } == {f"Brand {index}" for index in range(350)}


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


def test_number_conversion_extracts_currency_and_grouped_digits() -> None:
    assert _as_number("$4.1") == 4.1
    assert _as_number("170,000,000đ") == 170000000
    assert _as_number("EUR -1.250,75") == -1250.75


@pytest.mark.asyncio
async def test_name_field_is_unique_renameable_and_can_be_promoted(
    client: httpx.AsyncClient,
) -> None:
    headers, db_id = await _setup(client, "name-field@example.com")
    fields_response = await client.get(f"/databases/{db_id}/fields", headers=headers)
    name_field = next(field for field in fields_response.json() if field["type"] == "name")
    assert name_field["options"]["required"] is True

    renamed = await client.patch(
        f"/fields/{name_field['id']}",
        json={"name": "Entity title"},
        headers=headers,
    )
    assert renamed.status_code == 200, renamed.text

    duplicate = await client.post(
        f"/databases/{db_id}/fields",
        json={"name": " entity TITLE ", "type": "text", "options": {}},
        headers=headers,
    )
    assert duplicate.status_code == 409

    replacement_id = await _add_field(client, headers, db_id, "External title", "text")
    for entity_name, external_title in [("First", "Alpha"), ("Second", "Beta")]:
        created = await client.post(
            f"/databases/{db_id}/entities",
            json={"name": entity_name, "data": {replacement_id: external_title}},
            headers=headers,
        )
        assert created.status_code == 201, created.text

    converted = await client.post(
        f"/fields/{replacement_id}/convert-type",
        json={"target_type": "name", "dry_run": False},
        headers=headers,
    )
    assert converted.status_code == 200, converted.text
    assert converted.json()["field"]["type"] == "name"

    fields_after = (await client.get(f"/databases/{db_id}/fields", headers=headers)).json()
    assert len([field for field in fields_after if field["type"] == "name"]) == 1
    assert (
        next(field for field in fields_after if field["id"] == name_field["id"])["type"] == "text"
    )
    rows = (await client.get(f"/databases/{db_id}/entities", headers=headers)).json()
    assert {row["name"] for row in rows} == {"Alpha", "Beta"}


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
