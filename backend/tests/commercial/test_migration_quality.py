"""T3 immutable staging, conflict review and verified-promotion contracts."""

import httpx
import pytest


async def _signup(client: httpx.AsyncClient, email: str) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Quality Owner"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    workspace_id = (
        await client.get("/workspaces", headers={"Authorization": f"Bearer {token}"})
    ).json()[0]["id"]
    return token, workspace_id


def _headers(token: str, workspace_id: str, key: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}", "X-Workspace-ID": workspace_id}
    if key:
        headers["Idempotency-Key"] = key
    return headers


def _batch() -> dict[str, object]:
    return {
        "source_key": "notion-customers",
        "source_label": "Notion Customers export",
        "source_url": "https://notion.so/customers",
        "priority_cohort": True,
        "rows": [
            {
                "source_locator": "Customers!2",
                "raw_values": {"Company": "Acme", "Email": "ops@acme.test"},
                "record_type": "customer",
                "normalized_values": {"name": "Acme", "email": "ops@acme.test"},
                "mapping_confidence": 98,
            }
        ],
    }


@pytest.mark.asyncio
async def test_immutable_staging_review_promotion_and_replay(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _signup(client, "quality-owner@example.com")
    created = await client.post(
        "/commercial/quality/batches",
        json=_batch(),
        headers=_headers(token, workspace_id, "stage-notion-customers"),
    )
    assert created.status_code == 201, created.text
    replay = await client.post(
        "/commercial/quality/batches",
        json=_batch(),
        headers=_headers(token, workspace_id, "stage-notion-customers"),
    )
    assert replay.status_code == 200
    assert replay.headers["Idempotency-Replayed"] == "true"

    summary = await client.get("/commercial/quality/summary", headers=_headers(token, workspace_id))
    assert summary.status_code == 200, summary.text
    candidate = summary.json()["exceptions"][0]
    assert candidate["source_locator"] == "Customers!2"
    assert candidate["status"] == "pending"

    reviewed = await client.post(
        f"/commercial/quality/candidates/{candidate['id']}/review",
        json={
            "expected_version": candidate["version"],
            "status": "verified",
            "trust_tier": "verified",
            "review_notes": "Validated against source export",
        },
        headers=_headers(token, workspace_id, "review-acme-v1"),
    )
    assert reviewed.status_code == 200, reviewed.text
    promoted = await client.post(
        f"/commercial/quality/candidates/{candidate['id']}/promote",
        headers=_headers(token, workspace_id, "promote-acme-v1"),
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["trust_tier"] == "verified"
    assert promoted.json()["resulting_snapshot"]["name"] == "Acme"


@pytest.mark.asyncio
async def test_open_conflict_blocks_promotion(client: httpx.AsyncClient) -> None:
    token, workspace_id = await _signup(client, "quality-conflict@example.com")
    await client.post(
        "/commercial/quality/batches",
        json=_batch(),
        headers=_headers(token, workspace_id, "stage-conflict"),
    )
    candidate = (
        await client.get("/commercial/quality/summary", headers=_headers(token, workspace_id))
    ).json()["exceptions"][0]
    reviewed = await client.post(
        f"/commercial/quality/candidates/{candidate['id']}/review",
        json={
            "expected_version": candidate["version"],
            "status": "needs_review",
            "trust_tier": "partially_verified",
            "conflicts": [
                {"kind": "possible_duplicate", "detail": "Same company name in sheet"}
            ],
        },
        headers=_headers(token, workspace_id, "review-conflict"),
    )
    assert reviewed.status_code == 200, reviewed.text
    blocked = await client.post(
        f"/commercial/quality/candidates/{candidate['id']}/promote",
        headers=_headers(token, workspace_id, "promote-blocked"),
    )
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "MIGRATION_PROMOTION_BLOCKED"
