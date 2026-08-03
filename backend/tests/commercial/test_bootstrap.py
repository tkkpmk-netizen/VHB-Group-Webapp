"""Commercial Data foundation bootstrap contract tests."""

import httpx
import pytest

from app.core.config import Settings, get_settings
from app.main import app


async def _signup(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Commercial User"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    auth_headers = {"Authorization": f"Bearer {token}"}
    workspace_id = (await client.get("/workspaces", headers=auth_headers)).json()[0]["id"]
    return token, workspace_id


def _headers(token: str, workspace_id: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": workspace_id,
    }


@pytest.mark.asyncio
async def test_bootstrap_is_workspace_scoped_ordered_and_bounded(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _signup(client, "commercial-owner@example.com")

    response = await client.get(
        "/commercial/bootstrap",
        headers=_headers(token, workspace_id),
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["workspace_id"] == workspace_id
    assert payload["capability_version"] == "commercial-foundation-v1:0"
    assert [item["id"] for item in payload["destinations"]] == [
        "quality",
        "pricing",
    ]
    assert sum(item["fallback_eligible"] for item in payload["destinations"]) == 1
    assert payload["destinations"][0]["badge_count"] == 0
    assert all(item["badge_count"] is None for item in payload["destinations"][1:])
    assert all("records" not in item for item in payload["destinations"])


@pytest.mark.asyncio
async def test_bootstrap_requires_the_selected_workspace(
    client: httpx.AsyncClient,
) -> None:
    first_token, _ = await _signup(client, "commercial-first@example.com")
    _, second_workspace_id = await _signup(client, "commercial-second@example.com")

    response = await client.get(
        "/commercial/bootstrap",
        headers=_headers(first_token, second_workspace_id),
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_kill_switch_returns_no_destinations(
    client: httpx.AsyncClient,
) -> None:
    token, workspace_id = await _signup(client, "commercial-disabled@example.com")
    app.dependency_overrides[get_settings] = lambda: Settings(commercial_foundation_enabled=False)
    try:
        response = await client.get(
            "/commercial/bootstrap",
            headers=_headers(token, workspace_id),
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200, response.text
    assert response.json()["enabled"] is False
    assert response.json()["destinations"] == []
