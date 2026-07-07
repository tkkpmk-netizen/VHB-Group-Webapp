"""CM5 Google identity and CM6 notification integration tests."""

from collections.abc import AsyncGenerator
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import auth
from app.db.session import get_db
from app.main import app
from app.services.events import publish_next_outbox_event


async def _register(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "CM"},
    )
    token = response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=headers)).json()[0]
    return token, workspace["id"]


def _headers(token: str, workspace_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": workspace_id,
    }


@pytest.mark.asyncio
async def test_google_login_creates_identity_and_session(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def verify(_: str) -> dict[str, Any]:
        return {
            "sub": "google-new-user",
            "email": "google-new@example.com",
            "email_verified": True,
            "name": "Google User",
        }

    monkeypatch.setattr(auth, "verify_google_credential", verify)
    response = await client.post("/auth/google", json={"credential": "x" * 30})
    assert response.status_code == 200, response.text
    token = response.json()["access_token"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["email"] == "google-new@example.com"
    identities = await client.get("/auth/identities", headers={"Authorization": f"Bearer {token}"})
    assert identities.json()[0]["provider"] == "google"


@pytest.mark.asyncio
async def test_existing_email_requires_explicit_google_link(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    token, _ = await _register(client, "link-google@example.com")

    async def verify(_: str) -> dict[str, Any]:
        return {
            "sub": "google-link-subject",
            "email": "link-google@example.com",
            "email_verified": True,
        }

    monkeypatch.setattr(auth, "verify_google_credential", verify)
    denied = await client.post("/auth/google", json={"credential": "x" * 30})
    assert denied.status_code == 409
    linked = await client.post(
        "/auth/google/link",
        json={"credential": "x" * 30},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert linked.status_code == 200, linked.text
    assert (await client.post("/auth/google", json={"credential": "x" * 30})).status_code == 200


@pytest.mark.asyncio
async def test_workspace_membership_creates_in_app_notification(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _register(client, "notify-owner@example.com")
    member_token, _ = await _register(client, "notify-member@example.com")
    added = await client.post(
        "/workspaces/me/members",
        json={"email": "notify-member@example.com", "role": "viewer"},
        headers=_headers(owner_token, workspace_id),
    )
    assert added.status_code == 201, added.text
    member_headers = _headers(member_token, workspace_id)
    notifications = await client.get("/notifications", headers=member_headers)
    assert notifications.status_code == 200
    assert notifications.json()[0]["type"] == "workspace.member_added"
    count = await client.get("/notifications/unread-count", headers=member_headers)
    assert count.json()["count"] == 1
    notification_id = notifications.json()[0]["id"]
    assert (
        await client.post(f"/notifications/{notification_id}/read", headers=member_headers)
    ).status_code == 200
    assert (await client.get("/notifications/unread-count", headers=member_headers)).json()[
        "count"
    ] == 0


@pytest.mark.asyncio
async def test_notification_outbox_enqueues_email_when_enabled(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _register(client, "email-notify-owner@example.com")
    member_token, _ = await _register(client, "email-notify-member@example.com")
    await client.post(
        "/workspaces/me/members",
        json={"email": "email-notify-member@example.com", "role": "viewer"},
        headers=_headers(owner_token, workspace_id),
    )
    member_headers = _headers(member_token, workspace_id)
    await client.put(
        "/notifications/preferences",
        json={"in_app_enabled": True, "email_enabled": True},
        headers=member_headers,
    )
    database = await client.post(
        "/databases",
        json={"name": "Notify grants"},
        headers=_headers(owner_token, workspace_id),
    )
    member = (
        await client.get(
            "/workspaces/me/members",
            headers=_headers(owner_token, workspace_id),
        )
    ).json()
    target = next(item for item in member if item["email"] == "email-notify-member@example.com")
    await client.put(
        f"/resource-grants/database/{database.json()['id']}",
        json={"user_id": target["id"], "role": "viewer"},
        headers=_headers(owner_token, workspace_id),
    )

    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    session = await anext(generator)
    try:
        for _ in range(20):
            event = await publish_next_outbox_event(session)
            if event is None:
                break
    finally:
        await generator.aclose()
    jobs = await client.get("/jobs", headers=member_headers)
    assert any(job["type"] == "notification.email" for job in jobs.json())
