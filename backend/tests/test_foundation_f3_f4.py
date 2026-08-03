"""Authorization v2 and bounded row-query integration tests."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Test"},
    )
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=headers)).json()[0]
    return token, workspace["id"]


def _headers(token: str, workspace_id: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if workspace_id:
        result["X-Workspace-ID"] = workspace_id
    return result


@pytest.mark.asyncio
async def test_explicit_workspace_selection_and_viewer_guard(
    client: httpx.AsyncClient,
) -> None:
    owner_token, owner_workspace = await _register(client, "owner@example.com")
    viewer_token, _ = await _register(client, "viewer@example.com")

    response = await client.post(
        "/workspaces/me/members",
        json={"email": "viewer@example.com", "role": "viewer"},
        headers=_headers(owner_token),
    )
    assert response.status_code == 201, response.text

    # Multi-workspace accounts must select a tenant explicitly.
    response = await client.get("/workspaces/me", headers=_headers(viewer_token))
    assert response.status_code == 400
    response = await client.get("/workspaces/me", headers=_headers(viewer_token, owner_workspace))
    assert response.status_code == 200
    assert response.json()["role"] == "viewer"

    response = await client.post(
        "/databases",
        json={"name": "Forbidden"},
        headers=_headers(viewer_token, owner_workspace),
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_database_grant_can_reduce_editor_access(
    client: httpx.AsyncClient,
) -> None:
    owner_token, owner_workspace = await _register(client, "acl-owner@example.com")
    editor_token, _ = await _register(client, "acl-editor@example.com")
    editor = await client.post(
        "/workspaces/me/members",
        json={"email": "acl-editor@example.com", "role": "editor"},
        headers=_headers(owner_token),
    )
    database = await client.post(
        "/databases", json={"name": "Restricted"}, headers=_headers(owner_token)
    )
    database_id = database.json()["id"]
    grant = await client.put(
        f"/resource-grants/database/{database_id}",
        json={"user_id": editor.json()["id"], "role": "viewer"},
        headers=_headers(owner_token),
    )
    assert grant.status_code == 200, grant.text

    response = await client.get(
        f"/databases/{database_id}/entities",
        headers=_headers(editor_token, owner_workspace),
    )
    assert response.status_code == 200
    response = await client.post(
        f"/databases/{database_id}/entities",
        json={"name": "Test entity", "data": {}},
        headers=_headers(editor_token, owner_workspace),
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_row_query_paginates_filters_sorts_and_aggregates(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "query@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post("/databases", json={"name": "Sales"}, headers=headers)
    database_id = database.json()["id"]
    amount = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Amount", "type": "number", "options": {}},
        headers=headers,
    )
    amount_id = amount.json()["id"]
    for value in [10, 30, 20, 40]:
        response = await client.post(
            f"/databases/{database_id}/entities",
            json={"name": "Test entity", "data": {amount_id: value}},
            headers=headers,
        )
        assert response.status_code == 201

    response = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 2,
            "filters": [{"field_id": amount_id, "operator": "gte", "value": 20}],
            "sorts": [{"field_id": amount_id, "direction": "desc"}],
            "aggregations": [
                {"field_id": amount_id, "function": "sum"},
                {"field_id": amount_id, "function": "avg"},
                {"field_id": amount_id, "function": "count"},
                {"field_id": amount_id, "function": "filled"},
                {"field_id": amount_id, "function": "empty"},
            ],
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 3
    assert body["pages"] == 2
    assert [row["data"][amount_id] for row in body["items"]] == [40, 30]
    assert body["aggregates"][f"sum:{amount_id}"] == 90
    assert body["aggregates"][f"avg:{amount_id}"] == 30
    assert body["aggregates"][f"count:{amount_id}"] == 3
    assert body["aggregates"][f"filled:{amount_id}"] == 3
    assert body["aggregates"][f"empty:{amount_id}"] == 0

    text_field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Label", "type": "text", "options": {}},
        headers=headers,
    )
    invalid_calculation = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "aggregations": [
                {"field_id": text_field.json()["id"], "function": "sum"}
            ]
        },
        headers=headers,
    )
    assert invalid_calculation.status_code == 422
    assert "requires a numeric field" in invalid_calculation.json()["detail"]


@pytest.mark.asyncio
async def test_group_query_reports_total_not_loaded_count(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "group-total@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases", json={"name": "Grouped"}, headers=headers
    )
    database_id = database.json()["id"]
    group_field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Region", "type": "text", "options": {}},
        headers=headers,
    )
    group_field_id = group_field.json()["id"]
    for index, region in enumerate(["North", "North", "North", "South", "South"]):
        response = await client.post(
            f"/databases/{database_id}/entities",
            json={
                "name": f"Entity {index}",
                "data": {group_field_id: region},
            },
            headers=headers,
        )
        assert response.status_code == 201

    response = await client.post(
        f"/databases/{database_id}/entities/query",
        json={"page": 1, "page_size": 1, "group_by": group_field_id},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert {group["key"]: group["total"] for group in response.json()["groups"]} == {
        "North": 3,
        "South": 2,
    }


@pytest.mark.asyncio
async def test_row_query_rejects_unbounded_page_size(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _register(client, "bounds@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post("/databases", json={"name": "DB"}, headers=headers)
    response = await client.post(
        f"/databases/{database.json()['id']}/entities/query",
        json={"page_size": 201},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_row_search_runs_before_pagination_and_returns_all_match_ids(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "search-all@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases",
        json={"name": "Search all"},
        headers=headers,
    )
    database_id = database.json()["id"]
    for batch in range(3):
        names = [f"Ordinary {batch}-{index}" for index in range(100)]
        if batch == 2:
            names[-1] = "Needle after the old load limit"
        created = await client.post(
            f"/databases/{database_id}/entities/bulk",
            json={"names": names},
            headers=headers,
        )
        assert created.status_code == 201, created.text

    searched = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 10,
            "search": "needle",
            "include_match_ids": True,
        },
        headers=headers,
    )
    assert searched.status_code == 200, searched.text
    body = searched.json()
    assert body["total"] == 1
    assert body["items"][0]["name"] == "Needle after the old load limit"
    assert body["matched_entity_ids"] == [body["items"][0]["id"]]


@pytest.mark.asyncio
async def test_row_sort_runs_before_pagination_across_old_load_limit(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "sort-all@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases",
        json={"name": "Globally sorted"},
        headers=headers,
    )
    database_id = database.json()["id"]
    fields = await client.get(
        f"/databases/{database_id}/fields",
        headers=headers,
    )
    name_field = next(
        field
        for field in fields.json()
        if field["options"].get("system_key") == "name"
    )

    names = [f"Item {index:03d}" for index in reversed(range(300))]
    for start in range(0, len(names), 100):
        created = await client.post(
            f"/databases/{database_id}/entities/bulk",
            json={"names": names[start : start + 100]},
            headers=headers,
        )
        assert created.status_code == 201, created.text

    ascending = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 25,
            "sorts": [{"field_id": name_field["id"], "direction": "asc"}],
        },
        headers=headers,
    )
    descending = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 25,
            "sorts": [{"field_id": name_field["id"], "direction": "desc"}],
        },
        headers=headers,
    )

    assert ascending.status_code == 200, ascending.text
    assert descending.status_code == 200, descending.text
    assert ascending.json()["total"] == 300
    assert ascending.json()["items"][0]["name"] == "Item 000"
    assert ascending.json()["items"][-1]["name"] == "Item 024"
    assert descending.json()["items"][0]["name"] == "Item 299"
    assert descending.json()["items"][-1]["name"] == "Item 275"


@pytest.mark.asyncio
async def test_unique_id_sort_uses_numeric_sequence(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _register(client, "numeric-id-sort@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases", json={"name": "Numeric IDs"}, headers=headers
    )
    database_id = database.json()["id"]
    fields = await client.get(f"/databases/{database_id}/fields", headers=headers)
    id_field = next(
        field
        for field in fields.json()
        if field["options"].get("system_key") == "uid"
    )
    created = await client.post(
        f"/databases/{database_id}/entities/bulk",
        json={"names": [f"Item {index}" for index in range(1, 11)]},
        headers=headers,
    )
    assert created.status_code == 201, created.text

    descending = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 10,
            "sorts": [{"field_id": id_field["id"], "direction": "desc"}],
        },
        headers=headers,
    )

    assert descending.status_code == 200, descending.text
    assert [item["seq"] for item in descending.json()["items"]] == list(
        range(10, 0, -1)
    )


@pytest.mark.asyncio
async def test_database_history_can_be_scoped_to_one_entity(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "entity-history@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases", json={"name": "Entity history"}, headers=headers
    )
    database_id = database.json()["id"]
    price = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Price", "type": "number", "options": {}},
        headers=headers,
    )
    price_id = price.json()["id"]
    first = await client.post(
        f"/databases/{database_id}/entities",
        json={"name": "First item", "data": {price_id: 100}},
        headers=headers,
    )
    second = await client.post(
        f"/databases/{database_id}/entities",
        json={"name": "Second item", "data": {}},
        headers=headers,
    )
    updated = await client.patch(
        f"/entities/{first.json()['id']}",
        json={"name": "First item updated", "data": {price_id: 120}},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text

    history = await client.get(
        f"/databases/{database_id}/history",
        params={"entity_id": first.json()["id"]},
        headers=headers,
    )

    assert history.status_code == 200, history.text
    assert [item["action"] for item in history.json()] == [
        "entity.updated",
        "entity.created",
    ]
    assert all("Second item" not in item["summary"] for item in history.json())
    price_change = next(
        change
        for change in history.json()[0]["field_changes"]
        if change["field_id"] == price_id
    )
    assert price_change == {
        "field_id": price_id,
        "field_name": "Price",
        "before_value": 100,
        "after_value": 120,
    }
    assert history.json()[0]["actor_email"] == "entity-history@example.com"
    assert second.status_code == 201


@pytest.mark.asyncio
async def test_row_query_evaluates_nested_filter_tree_before_pagination(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "filter-tree@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases",
        json={"name": "Nested filters"},
        headers=headers,
    )
    database_id = database.json()["id"]
    region = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Region", "type": "text", "options": {}},
        headers=headers,
    )
    score = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Score", "type": "number", "options": {}},
        headers=headers,
    )
    region_id = region.json()["id"]
    score_id = score.json()["id"]
    rows = [
        ("North low", "North", 2),
        ("North high", "North", 20),
        ("South high", "South", 30),
        ("West high", "West", 40),
    ]
    for name, region_value, score_value in rows:
        created = await client.post(
            f"/databases/{database_id}/entities",
            json={
                "name": name,
                "data": {region_id: region_value, score_id: score_value},
            },
            headers=headers,
        )
        assert created.status_code == 201, created.text

    response = await client.post(
        f"/databases/{database_id}/entities/query",
        json={
            "page": 1,
            "page_size": 1,
            "filter_tree": {
                "conj": "and",
                "rules": [
                    {"field_id": score_id, "operator": "gt", "value": 10},
                    {
                        "conj": "or",
                        "rules": [
                            {
                                "field_id": region_id,
                                "operator": "eq",
                                "value": "North",
                            },
                            {
                                "field_id": region_id,
                                "operator": "eq",
                                "value": "South",
                            },
                        ],
                    },
                ],
            },
            "sorts": [{"field_id": score_id, "direction": "desc"}],
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert response.json()["items"][0]["name"] == "South high"


@pytest.mark.asyncio
async def test_bulk_update_applies_one_field_to_additive_selection(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _register(client, "bulk-edit@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post(
        "/databases",
        json={"name": "Bulk edit"},
        headers=headers,
    )
    database_id = database.json()["id"]
    status_field = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Review note", "type": "text", "options": {}},
        headers=headers,
    )
    field_id = status_field.json()["id"]
    created = await client.post(
        f"/databases/{database_id}/entities/bulk",
        json={"names": ["One", "Two", "Three"]},
        headers=headers,
    )
    entity_ids = [item["id"] for item in created.json()]

    updated = await client.patch(
        f"/databases/{database_id}/entities/bulk",
        json={
            "entity_ids": [entity_ids[0], entity_ids[2]],
            "field_id": field_id,
            "value": "Approved",
        },
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert [item["data"][field_id] for item in updated.json()] == [
        "Approved",
        "Approved",
    ]
    untouched = await client.get(
        f"/databases/{database_id}/entities",
        headers=headers,
    )
    by_id = {item["id"]: item for item in untouched.json()}
    assert by_id[entity_ids[1]]["data"].get(field_id) is None
