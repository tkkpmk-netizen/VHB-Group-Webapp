"""Workspace Space/Folder resource-tree tests."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> str:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "T"},
    )
    assert response.status_code == 201, response.text
    return response.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_space_folder_database_flow(client: httpx.AsyncClient) -> None:
    token = await _register(client, "resources@example.com")
    headers = _auth(token)

    response = await client.post(
        "/spaces",
        json={"name": "Sales", "icon": "💼", "color": "blue"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    space_id = response.json()["id"]

    response = await client.post(
        f"/spaces/{space_id}/folders",
        json={"name": "CRM"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    folder_id = response.json()["id"]

    response = await client.post(
        f"/spaces/{space_id}/folders",
        json={"name": "Leads", "parent_id": folder_id},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    child_id = response.json()["id"]

    response = await client.get(f"/spaces/{space_id}/folders", headers=headers)
    assert response.status_code == 200
    assert {folder["name"] for folder in response.json()} == {"CRM", "Leads"}

    response = await client.post(
        "/databases",
        json={"name": "Customers", "folder_id": child_id},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["folder_id"] == child_id


@pytest.mark.asyncio
async def test_resource_tree_rejects_cycles(client: httpx.AsyncClient) -> None:
    token = await _register(client, "cycles@example.com")
    headers = _auth(token)
    space = await client.post("/spaces", json={"name": "Ops"}, headers=headers)
    space_id = space.json()["id"]
    parent = await client.post(
        f"/spaces/{space_id}/folders", json={"name": "Parent"}, headers=headers
    )
    child = await client.post(
        f"/spaces/{space_id}/folders",
        json={"name": "Child", "parent_id": parent.json()["id"]},
        headers=headers,
    )

    response = await client.patch(
        f"/folders/{parent.json()['id']}",
        json={"parent_id": child.json()["id"]},
        headers=headers,
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_resources_are_workspace_isolated(client: httpx.AsyncClient) -> None:
    token_a = await _register(client, "resources-a@example.com")
    token_b = await _register(client, "resources-b@example.com")
    space_a = await client.post("/spaces", json={"name": "Private"}, headers=_auth(token_a))
    space_id = space_a.json()["id"]

    response = await client.get("/spaces", headers=_auth(token_b))
    assert response.status_code == 200
    assert [space["name"] for space in response.json()] == ["General"]

    response = await client.post(
        f"/spaces/{space_id}/folders",
        json={"name": "Forbidden"},
        headers=_auth(token_b),
    )
    assert response.status_code == 404

    response = await client.post(
        "/databases",
        json={"name": "Forbidden", "folder_id": "00000000-0000-0000-0000-000000000000"},
        headers=_auth(token_b),
    )
    assert response.status_code == 404
