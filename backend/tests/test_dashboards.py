"""CM4 dashboard designer integration tests."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "CM4"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return {**auth, "X-Workspace-ID": workspace["id"]}


@pytest.mark.asyncio
async def test_dashboard_widget_executes_grouped_f4_query(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "cm4-dashboard@example.com")
    database = await client.post("/databases", json={"name": "Revenue"}, headers=headers)
    database_id = database.json()["id"]
    segment = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Segment", "type": "text", "options": {}},
        headers=headers,
    )
    amount = await client.post(
        f"/databases/{database_id}/fields",
        json={"name": "Amount", "type": "number", "options": {}},
        headers=headers,
    )
    segment_id = segment.json()["id"]
    amount_id = amount.json()["id"]
    for name, value in [("SMB", 10), ("SMB", 20), ("Enterprise", 50)]:
        await client.post(
            f"/databases/{database_id}/rows",
            json={"data": {segment_id: name, amount_id: value}},
            headers=headers,
        )

    dashboard = await client.post(
        "/dashboards",
        json={"name": "Revenue overview"},
        headers=headers,
    )
    assert dashboard.status_code == 201, dashboard.text
    widget = await client.post(
        f"/dashboards/{dashboard.json()['id']}/widgets",
        json={
            "database_id": database_id,
            "title": "Revenue by segment",
            "type": "bar",
            "query": {
                "group_by": segment_id,
                "aggregations": [{"field_id": amount_id, "function": "sum"}],
            },
        },
        headers=headers,
    )
    assert widget.status_code == 201, widget.text

    data = await client.get(
        f"/dashboard-widgets/{widget.json()['id']}/data",
        headers=headers,
    )
    assert data.status_code == 200, data.text
    groups = {
        item["key"]: item["aggregates"][f"sum:{amount_id}"]
        for item in data.json()["data"]["groups"]
    }
    assert groups == {"Enterprise": 50, "SMB": 30}


@pytest.mark.asyncio
async def test_dashboard_uses_generic_resource_grants(client: httpx.AsyncClient) -> None:
    owner_headers = await _register(client, "cm4-owner@example.com")
    viewer_headers = await _register(client, "cm4-viewer@example.com")
    viewer_token = viewer_headers["Authorization"]
    workspace_id = owner_headers["X-Workspace-ID"]
    member = await client.post(
        "/workspaces/me/members",
        json={"email": "cm4-viewer@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    dashboard = await client.post(
        "/dashboards", json={"name": "Shared dashboard"}, headers=owner_headers
    )
    dashboard_id = dashboard.json()["id"]
    grant = await client.put(
        f"/resource-grants/dashboard/{dashboard_id}",
        json={"user_id": member.json()["id"], "role": "editor"},
        headers=owner_headers,
    )
    assert grant.status_code == 200, grant.text
    updated = await client.patch(
        f"/dashboards/{dashboard_id}",
        json={"name": "Viewer edited"},
        headers={
            "Authorization": viewer_token,
            "X-Workspace-ID": workspace_id,
        },
    )
    assert updated.status_code == 200, updated.text
