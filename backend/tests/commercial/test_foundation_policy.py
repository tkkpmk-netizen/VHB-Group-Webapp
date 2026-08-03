"""Commercial Foundation capability, receipt, conflict and audit tests."""

import asyncio

import httpx
import pytest


async def _signup(
    client: httpx.AsyncClient,
    email: str,
) -> tuple[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "Commercial User"},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace_id = (await client.get("/workspaces", headers=auth)).json()[0]["id"]
    return token, workspace_id


def _headers(
    token: str,
    workspace_id: str,
    *,
    idempotency_key: str | None = None,
    request_id: str | None = None,
) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Workspace-ID": workspace_id,
    }
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key
    if request_id is not None:
        headers["X-Request-ID"] = request_id
    return headers


async def _add_member(
    client: httpx.AsyncClient,
    *,
    owner_token: str,
    workspace_id: str,
    email: str,
    role: str,
) -> dict[str, str]:
    response = await client.post(
        "/workspaces/me/members",
        json={"email": email, "role": role},
        headers=_headers(owner_token, workspace_id),
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
async def test_user_override_precedes_role_denial_without_stale_allow_cache(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "cap-owner@example.com")
    viewer_token, _ = await _signup(client, "cap-viewer@example.com")
    viewer = await _add_member(
        client,
        owner_token=owner_token,
        workspace_id=workspace_id,
        email="cap-viewer@example.com",
        role="viewer",
    )
    capability_path = "/commercial/capabilities/commercial.quality.read"
    denied = await client.put(
        capability_path,
        json={
            "subject_type": "role",
            "subject_id": "viewer",
            "allowed": False,
            "expected_version": 0,
        },
        headers=_headers(
            owner_token,
            workspace_id,
            idempotency_key="deny-viewer-quality",
        ),
    )
    assert denied.status_code == 200, denied.text
    assert denied.json()["version"] == 1
    assert denied.json()["policy_version"] == 1

    viewer_headers = _headers(viewer_token, workspace_id)
    hidden = await client.get("/commercial/bootstrap", headers=viewer_headers)
    assert hidden.status_code == 200, hidden.text
    assert "quality" not in [item["id"] for item in hidden.json()["destinations"]]
    assert hidden.json()["capability_version"] == "commercial-foundation-v1:1"

    allowed = await client.put(
        capability_path,
        json={
            "subject_type": "user",
            "subject_id": viewer["id"],
            "allowed": True,
            "expected_version": 0,
        },
        headers=_headers(
            owner_token,
            workspace_id,
            idempotency_key="allow-user-quality",
        ),
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["policy_version"] == 2
    refreshed = await client.get("/commercial/bootstrap", headers=viewer_headers)
    assert "quality" in [item["id"] for item in refreshed.json()["destinations"]]
    assert refreshed.json()["capability_version"] == "commercial-foundation-v1:2"


@pytest.mark.asyncio
async def test_hidden_commercial_destinations_cannot_be_opened_by_direct_api(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "direct-owner@example.com")
    viewer_token, _ = await _signup(client, "direct-viewer@example.com")
    await _add_member(
        client,
        owner_token=owner_token,
        workspace_id=workspace_id,
        email="direct-viewer@example.com",
        role="viewer",
    )

    for index, capability in enumerate(
        (
            "commercial.products.read",
            "commercial.customers.read",
            "commercial.pricing.read",
        )
    ):
        denied = await client.put(
            f"/commercial/capabilities/{capability}",
            json={
                "subject_type": "role",
                "subject_id": "viewer",
                "allowed": False,
                "expected_version": 0,
            },
            headers=_headers(
                owner_token,
                workspace_id,
                idempotency_key=f"deny-direct-{index}",
            ),
        )
        assert denied.status_code == 200, denied.text

    viewer_headers = _headers(viewer_token, workspace_id)
    for path in ("/commercial/products", "/commercial/customers", "/commercial/pricing"):
        response = await client.get(path, headers=viewer_headers)
        assert response.status_code == 403, (path, response.text)


@pytest.mark.asyncio
async def test_command_replay_payload_mismatch_and_audit_are_durable(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "receipt-owner@example.com")
    path = "/commercial/capabilities/commercial.pricing.read"
    payload = {
        "subject_type": "role",
        "subject_id": "viewer",
        "allowed": False,
        "expected_version": 0,
    }
    headers = _headers(
        owner_token,
        workspace_id,
        idempotency_key="pricing-viewer-v1",
    )
    first = await client.put(path, json=payload, headers=headers)
    replay = await client.put(path, json=payload, headers=headers)
    assert first.status_code == replay.status_code == 200
    assert first.json() == replay.json()
    assert first.headers["Idempotency-Replayed"] == "false"
    assert replay.headers["Idempotency-Replayed"] == "true"

    mismatch = await client.put(
        path,
        json={**payload, "allowed": True, "expected_version": 1},
        headers=headers,
    )
    assert mismatch.status_code == 409
    assert mismatch.headers["content-type"].startswith("application/problem+json")
    assert mismatch.json()["code"] == "IDEMPOTENCY_KEY_REUSED"

    events = await client.get(
        "/audit-events",
        params={"action": "commercial.capability_changed"},
        headers=_headers(owner_token, workspace_id),
    )
    assert events.status_code == 200
    assert len(events.json()) == 1


@pytest.mark.asyncio
async def test_version_conflict_has_machine_contract_and_request_id(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "version-owner@example.com")
    path = "/commercial/capabilities/commercial.products.read"
    first = await client.put(
        path,
        json={
            "subject_type": "role",
            "subject_id": "viewer",
            "allowed": False,
            "expected_version": 0,
        },
        headers=_headers(owner_token, workspace_id, idempotency_key="products-v1"),
    )
    assert first.status_code == 200, first.text

    stale = await client.put(
        path,
        json={
            "subject_type": "role",
            "subject_id": "viewer",
            "allowed": True,
            "expected_version": 0,
        },
        headers=_headers(
            owner_token,
            workspace_id,
            idempotency_key="products-stale",
            request_id="commercial-conflict-test",
        ),
    )
    assert stale.status_code == 409
    problem = stale.json()
    assert problem["code"] == "VERSION_CONFLICT"
    assert problem["request_id"] == "commercial-conflict-test"
    assert problem["conflict"] == {
        "code": "VERSION_CONFLICT",
        "expected_version": 0,
        "current_version": 1,
        "changed_fields": [{"path": "allowed"}],
        "rebase_actions": ["refresh", "compare", "retry"],
        "request_id": "commercial-conflict-test",
    }


@pytest.mark.asyncio
async def test_failed_command_rolls_back_receipt_and_policy(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "rollback-owner@example.com")
    path = "/commercial/capabilities/commercial.customers.read"
    headers = _headers(
        owner_token,
        workspace_id,
        idempotency_key="corrected-subject",
    )
    invalid = await client.put(
        path,
        json={
            "subject_type": "role",
            "subject_id": "not-a-role",
            "allowed": False,
            "expected_version": 0,
        },
        headers=headers,
    )
    assert invalid.status_code == 422

    corrected = await client.put(
        path,
        json={
            "subject_type": "role",
            "subject_id": "viewer",
            "allowed": False,
            "expected_version": 0,
        },
        headers=headers,
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["policy_version"] == 1


@pytest.mark.asyncio
async def test_cohort_denial_and_manage_permission_are_server_enforced(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "cohort-owner@example.com")
    editor_token, _ = await _signup(client, "cohort-editor@example.com")
    await _add_member(
        client,
        owner_token=owner_token,
        workspace_id=workspace_id,
        email="cohort-editor@example.com",
        role="editor",
    )
    denied = await client.put(
        "/commercial/cohort",
        json={"enabled": False, "cohort": "foundation", "expected_version": 0},
        headers=_headers(editor_token, workspace_id, idempotency_key="editor-denied"),
    )
    assert denied.status_code == 403

    disabled = await client.put(
        "/commercial/cohort",
        json={"enabled": False, "cohort": "foundation", "expected_version": 0},
        headers=_headers(owner_token, workspace_id, idempotency_key="disable-cohort"),
    )
    assert disabled.status_code == 200, disabled.text
    bootstrap = await client.get(
        "/commercial/bootstrap",
        headers=_headers(owner_token, workspace_id),
    )
    assert bootstrap.status_code == 200
    assert bootstrap.json()["enabled"] is False
    assert bootstrap.json()["destinations"] == []


@pytest.mark.asyncio
async def test_concurrent_stale_updates_have_one_atomic_winner(
    client: httpx.AsyncClient,
) -> None:
    owner_token, workspace_id = await _signup(client, "concurrency-owner@example.com")
    path = "/commercial/capabilities/commercial.quality.read"
    payload = {
        "subject_type": "role",
        "subject_id": "viewer",
        "expected_version": 0,
    }

    first, second = await asyncio.gather(
        client.put(
            path,
            json={**payload, "allowed": False},
            headers=_headers(
                owner_token,
                workspace_id,
                idempotency_key="concurrent-deny",
            ),
        ),
        client.put(
            path,
            json={**payload, "allowed": True},
            headers=_headers(
                owner_token,
                workspace_id,
                idempotency_key="concurrent-allow",
            ),
        ),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    conflict = first if first.status_code == 409 else second
    assert conflict.json()["code"] == "VERSION_CONFLICT"
    assert conflict.json()["conflict"]["current_version"] == 1

    events = await client.get(
        "/audit-events",
        params={"action": "commercial.capability_changed"},
        headers=_headers(owner_token, workspace_id),
    )
    assert len(events.json()) == 1
