"""Integration tests for the auth flow (requires Postgres)."""

import httpx
import pytest

CREDS = {"email": "user@example.com", "password": "supersecret1"}


@pytest.mark.asyncio
async def test_signup_login_me_flow(client: httpx.AsyncClient) -> None:
    # signup
    r = await client.post("/auth/signup", json={**CREDS, "full_name": "VHB User"})
    assert r.status_code == 201, r.text
    assert r.json()["access_token"]

    # duplicate signup → 409
    r = await client.post("/auth/signup", json=CREDS)
    assert r.status_code == 409

    # login
    r = await client.post("/auth/login", json=CREDS)
    assert r.status_code == 200
    token = r.json()["access_token"]

    # /me with token
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == CREDS["email"]
    assert body["full_name"] == "VHB User"


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(client: httpx.AsyncClient) -> None:
    await client.post("/auth/signup", json=CREDS)
    r = await client.post("/auth/login", json={**CREDS, "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_without_token_rejected(client: httpx.AsyncClient) -> None:
    r = await client.get("/auth/me")
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_me_with_bad_token_rejected(client: httpx.AsyncClient) -> None:
    r = await client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401
