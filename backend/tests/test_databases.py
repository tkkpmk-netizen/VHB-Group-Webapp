"""Workspace auto-create + database CRUD + tenant isolation (requires Postgres)."""

import httpx
import pytest


async def _register(client: httpx.AsyncClient, email: str) -> str:
    r = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "T"},
    )
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_signup_creates_workspace(client: httpx.AsyncClient) -> None:
    token = await _register(client, "a@example.com")
    r = await client.get("/workspaces/me", headers=_auth(token))
    assert r.status_code == 200
    body = r.json()
    assert body["member_count"] == 1
    assert "Workspace" in body["name"]
    spaces = await client.get("/spaces", headers=_auth(token))
    assert spaces.status_code == 200
    assert [space["name"] for space in spaces.json()] == ["General"]


@pytest.mark.asyncio
async def test_database_crud(client: httpx.AsyncClient) -> None:
    token = await _register(client, "a@example.com")

    # empty initially
    r = await client.get("/databases", headers=_auth(token))
    assert r.status_code == 200
    assert r.json() == []

    # create
    r = await client.post("/databases", json={"name": "CRM", "icon": "📇"}, headers=_auth(token))
    assert r.status_code == 201, r.text
    db_id = r.json()["id"]

    # list shows it
    r = await client.get("/databases", headers=_auth(token))
    assert len(r.json()) == 1
    assert r.json()[0]["name"] == "CRM"

    # delete
    r = await client.delete(f"/databases/{db_id}", headers=_auth(token))
    assert r.status_code == 204
    r = await client.get("/databases", headers=_auth(token))
    assert r.json() == []


@pytest.mark.asyncio
async def test_database_isolated_per_workspace(client: httpx.AsyncClient) -> None:
    token_a = await _register(client, "a@example.com")
    token_b = await _register(client, "b@example.com")

    await client.post("/databases", json={"name": "A-secret"}, headers=_auth(token_a))

    # B must not see A's database
    r = await client.get("/databases", headers=_auth(token_b))
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_databases_require_auth(client: httpx.AsyncClient) -> None:
    r = await client.get("/databases")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_database_favorite_is_reflected_in_context_data(
    client: httpx.AsyncClient,
) -> None:
    token = await _register(client, "favorite@example.com")
    created = await client.post(
        "/databases", json={"name": "Pinned CRM"}, headers=_auth(token)
    )
    database_id = created.json()["id"]

    favorite = await client.put(
        f"/databases/{database_id}/favorite", headers=_auth(token)
    )
    assert favorite.status_code == 204
    listed = await client.get("/databases", headers=_auth(token))
    assert listed.json()[0]["is_favorite"] is True

    unfavorite = await client.delete(
        f"/databases/{database_id}/favorite", headers=_auth(token)
    )
    assert unfavorite.status_code == 204
    listed = await client.get("/databases", headers=_auth(token))
    assert listed.json()[0]["is_favorite"] is False
