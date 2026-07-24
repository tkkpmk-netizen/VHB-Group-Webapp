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
        json={"name": "Sales", "icon": "briefcase", "color": "#7b68ee"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    space_id = response.json()["id"]
    assert response.json()["icon"] == "briefcase"

    response = await client.post(
        f"/spaces/{space_id}/folders",
        json={"name": "CRM", "icon": "folder.1"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    folder_id = response.json()["id"]
    assert response.json()["icon"] == "folder.1"

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
        "/databases", json={"name": "Customers", "icon": "address-book.1"}, headers=headers
    )
    assert response.status_code == 201, response.text
    customer_id = response.json()["id"]
    assert response.json()["icon"] == "address-book.1"
    customer_placement = await client.post(
        f"/spaces/{space_id}/databases",
        json={"database_id": customer_id, "folder_id": child_id},
        headers=headers,
    )
    assert customer_placement.status_code == 201, customer_placement.text
    canonical_layouts = await client.get(
        f"/databases/{customer_id}/layouts", headers=headers
    )
    placement_layouts = await client.get(
        f"/databases/{customer_id}/layouts",
        params={"placement_id": customer_placement.json()["id"]},
        headers=headers,
    )
    assert canonical_layouts.status_code == placement_layouts.status_code == 200
    assert [layout["name"] for layout in placement_layouts.json()] == ["Table"]
    assert placement_layouts.json()[0]["id"] != canonical_layouts.json()[0]["id"]
    assert placement_layouts.json()[0]["source_layout_id"] == canonical_layouts.json()[0]["id"]

    renamed_placement_layout = await client.patch(
        f"/layouts/{placement_layouts.json()[0]['id']}",
        json={"name": "Sales table"},
        headers=headers,
    )
    assert renamed_placement_layout.status_code == 200
    canonical_after_rename = await client.get(
        f"/databases/{customer_id}/layouts", headers=headers
    )
    assert canonical_after_rename.json()[0]["name"] == "Table"

    second = await client.post("/databases", json={"name": "Accounts"}, headers=headers)
    assert second.status_code == 201, second.text
    second_placement = await client.post(
        f"/spaces/{space_id}/databases",
        json={"database_id": second.json()["id"], "folder_id": child_id},
        headers=headers,
    )
    assert second_placement.status_code == 201, second_placement.text

    reordered = await client.post(
        f"/spaces/{space_id}/databases/reorder",
        json={
            "items": [
                {"id": second_placement.json()["id"], "folder_id": folder_id, "order": 0},
                {"id": customer_placement.json()["id"], "folder_id": folder_id, "order": 1},
            ]
        },
        headers=headers,
    )
    assert reordered.status_code == 204, reordered.text

    placements = await client.get(f"/spaces/{space_id}/databases", headers=headers)
    assert placements.status_code == 200
    placed = [item for item in placements.json() if item["folder_id"] == folder_id]
    assert [(item["database"]["name"], item["order"]) for item in placed] == [
        ("Accounts", 0),
        ("Customers", 1),
    ]

    second_space = await client.post("/spaces", json={"name": "Operations"}, headers=headers)
    assert second_space.status_code == 201, second_space.text
    duplicate_database = await client.post(
        f"/spaces/{second_space.json()['id']}/databases",
        json={"database_id": customer_id},
        headers=headers,
    )
    assert duplicate_database.status_code == 201, duplicate_database.text
    second_space_layouts = await client.get(
        f"/databases/{customer_id}/layouts",
        params={"placement_id": duplicate_database.json()["id"]},
        headers=headers,
    )
    assert second_space_layouts.status_code == 200
    assert second_space_layouts.json()[0]["name"] == "Table"
    assert second_space_layouts.json()[0]["id"] != placement_layouts.json()[0]["id"]

    inventory = await client.get("/databases", headers=headers)
    assert inventory.status_code == 200
    assert {item["name"] for item in inventory.json()} == {"Accounts", "Customers"}

    dashboard = await client.get(f"/spaces/{space_id}/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["space_id"] == space_id
    assert dashboard.json()["is_default"] is True


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

    database_b = await client.post(
        "/databases", json={"name": "B database"}, headers=_auth(token_b)
    )
    response = await client.post(
        f"/spaces/{space_id}/databases",
        json={"database_id": database_b.json()["id"]},
        headers=_auth(token_b),
    )
    assert response.status_code == 404
