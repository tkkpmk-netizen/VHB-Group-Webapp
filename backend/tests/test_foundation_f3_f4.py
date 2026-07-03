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
        f"/databases/{database_id}/grants",
        json={"user_id": editor.json()["id"], "role": "viewer"},
        headers=_headers(owner_token),
    )
    assert grant.status_code == 200, grant.text

    response = await client.get(
        f"/databases/{database_id}/rows",
        headers=_headers(editor_token, owner_workspace),
    )
    assert response.status_code == 200
    response = await client.post(
        f"/databases/{database_id}/rows",
        json={"data": {}},
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
            f"/databases/{database_id}/rows",
            json={"data": {amount_id: value}},
            headers=headers,
        )
        assert response.status_code == 201

    response = await client.post(
        f"/databases/{database_id}/rows/query",
        json={
            "page": 1,
            "page_size": 2,
            "filters": [{"field_id": amount_id, "operator": "gte", "value": 20}],
            "sorts": [{"field_id": amount_id, "direction": "desc"}],
            "aggregations": [
                {"field_id": amount_id, "function": "sum"},
                {"field_id": amount_id, "function": "avg"},
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


@pytest.mark.asyncio
async def test_row_query_rejects_unbounded_page_size(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _register(client, "bounds@example.com")
    headers = _headers(token, workspace_id)
    database = await client.post("/databases", json={"name": "DB"}, headers=headers)
    response = await client.post(
        f"/databases/{database.json()['id']}/rows/query",
        json={"page_size": 201},
        headers=headers,
    )
    assert response.status_code == 422
