"""F7/F8/F9 production-hardening tests."""

from collections.abc import AsyncGenerator

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.session import get_db
from app.main import app
from app.services.events import publish_next_outbox_event


async def _signup(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Hardening"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return token, workspace["id"]


@pytest.mark.asyncio
async def test_logout_revokes_redis_session(client: httpx.AsyncClient) -> None:
    token, _ = await _signup(client, "logout@example.com")
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/auth/me", headers=headers)).status_code == 200
    assert (await client.post("/auth/logout", headers=headers)).status_code == 204
    assert (await client.get("/auth/me", headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_security_change_creates_audit_and_outbox(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "audit-owner@example.com")
    await _signup(client, "audit-member@example.com")
    headers = {
        "Authorization": f"Bearer {owner_token}",
        "X-Workspace-ID": workspace_id,
    }
    added = await client.post(
        "/workspaces/me/members",
        json={"email": "audit-member@example.com", "role": "viewer"},
        headers=headers,
    )
    assert added.status_code == 201, added.text
    events = await client.get("/audit-events", headers=headers)
    assert events.status_code == 200
    assert events.json()[0]["action"] == "workspace.member_added"

    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    session = await anext(generator)
    try:
        event = await publish_next_outbox_event(session)
        assert event is not None
        assert event.published_at is not None
    finally:
        await generator.aclose()


@pytest.mark.asyncio
async def test_readiness_metrics_and_request_id(client: httpx.AsyncClient) -> None:
    ready = await client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["redis"] == "ok"
    health = await client.get("/health", headers={"X-Request-ID": "test-request"})
    assert health.headers["X-Request-ID"] == "test-request"
    metrics = await client.get("/metrics")
    assert metrics.status_code == 200
    assert "vhb_http_requests_total" in metrics.text


def test_production_config_rejects_default_secrets() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production")


def test_production_config_accepts_overrides() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        jwt_secret="secure-production-secret-that-is-long-enough",
        storage_secret_key="secure-storage-secret",
    )
    assert settings.environment == "production"
