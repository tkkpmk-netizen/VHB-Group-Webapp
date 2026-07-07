"""CM3 generic resource authorization integration tests."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "CM3"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return token, workspace["id"]


def _headers(token: str, workspace_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": workspace_id,
    }


@pytest.mark.asyncio
async def test_document_grant_overrides_workspace_role_and_can_be_removed(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _register(client, "cm3-owner@example.com")
    viewer_token, _ = await _register(client, "cm3-viewer@example.com")
    owner_headers = _headers(owner_token, workspace_id)
    viewer_headers = _headers(viewer_token, workspace_id)
    member = await client.post(
        "/workspaces/me/members",
        json={"email": "cm3-viewer@example.com", "role": "viewer"},
        headers=owner_headers,
    )
    document = await client.post(
        "/documents",
        json={"title": "Shared specification"},
        headers=owner_headers,
    )
    document_id = document.json()["id"]

    granted = await client.put(
        f"/resource-grants/document/{document_id}",
        json={"user_id": member.json()["id"], "role": "editor"},
        headers=owner_headers,
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["resource_type"] == "document"

    updated = await client.patch(
        f"/documents/{document_id}",
        json={"title": "Edited by viewer"},
        headers=viewer_headers,
    )
    assert updated.status_code == 200, updated.text

    downgraded = await client.put(
        f"/resource-grants/document/{document_id}",
        json={"user_id": member.json()["id"], "role": "viewer"},
        headers=owner_headers,
    )
    assert downgraded.status_code == 200
    assert (
        await client.patch(
            f"/documents/{document_id}",
            json={"title": "Forbidden"},
            headers=viewer_headers,
        )
    ).status_code == 403
    assert (
        await client.get(f"/documents/{document_id}", headers=viewer_headers)
    ).status_code == 200

    removed = await client.delete(
        f"/resource-grants/document/{document_id}/{member.json()['id']}",
        headers=owner_headers,
    )
    assert removed.status_code == 204
    assert (
        await client.patch(
            f"/documents/{document_id}",
            json={"title": "Still forbidden"},
            headers=viewer_headers,
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_only_resource_managers_can_manage_grants(client: httpx.AsyncClient) -> None:
    owner_token, workspace_id = await _register(client, "cm3-manager-owner@example.com")
    editor_token, _ = await _register(client, "cm3-manager-editor@example.com")
    owner_headers = _headers(owner_token, workspace_id)
    editor_headers = _headers(editor_token, workspace_id)
    editor = await client.post(
        "/workspaces/me/members",
        json={"email": "cm3-manager-editor@example.com", "role": "editor"},
        headers=owner_headers,
    )
    database = await client.post(
        "/databases",
        json={"name": "Access controlled"},
        headers=owner_headers,
    )
    database_id = database.json()["id"]

    denied = await client.get(
        f"/resource-grants/database/{database_id}",
        headers=editor_headers,
    )
    assert denied.status_code == 403

    manager = await client.put(
        f"/resource-grants/database/{database_id}",
        json={"user_id": editor.json()["id"], "role": "manager"},
        headers=owner_headers,
    )
    assert manager.status_code == 200
    allowed = await client.get(
        f"/resource-grants/database/{database_id}",
        headers=editor_headers,
    )
    assert allowed.status_code == 200
    assert allowed.json()[0]["role"] == "manager"


@pytest.mark.asyncio
async def test_resource_grants_are_workspace_scoped(client: httpx.AsyncClient) -> None:
    owner_a, workspace_a = await _register(client, "cm3-scope-a@example.com")
    owner_b, workspace_b = await _register(client, "cm3-scope-b@example.com")
    document = await client.post(
        "/documents",
        json={"title": "Workspace A"},
        headers=_headers(owner_a, workspace_a),
    )
    response = await client.get(
        f"/resource-grants/document/{document.json()['id']}",
        headers=_headers(owner_b, workspace_b),
    )
    assert response.status_code == 404
