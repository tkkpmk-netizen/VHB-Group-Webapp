"""T0J durable execution, context propagation, and observability tests."""

import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.main import app
from app.models.job import Job, JobStatus
from app.services.job_handlers import (
    JobExecutionContext,
    registered_job_types,
)
from app.services.jobs import (
    JobCancelledError,
    cancel_job_execution,
    claim_next_job,
    fail_job,
    structured_job_error,
    update_job_progress,
)


async def _register(client: httpx.AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret1", "full_name": "T0J"},
    )
    token = response.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    workspace = (await client.get("/workspaces", headers=auth)).json()[0]
    return {**auth, "X-Workspace-ID": workspace["id"]}


async def _session() -> tuple[AsyncSession, AsyncGenerator[AsyncSession]]:
    override = app.dependency_overrides[get_db]
    generator: AsyncGenerator[AsyncSession] = override()
    return await anext(generator), generator


def test_registry_contains_every_builtin_handler() -> None:
    assert registered_job_types() == {
        "asset.verify",
        "database.export",
        "database.import",
        "file.inspect",
        "notification.email",
        "site.build",
        "system.noop",
    }


@pytest.mark.asyncio
async def test_operation_context_and_child_chunk_are_idempotent(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "job-context@example.com")
    headers.update(
        {
            "X-Request-ID": "request-123",
            "X-Command-ID": "command-parent",
            "X-Correlation-ID": "correlation-123",
            "X-Causation-ID": "http-parent",
        }
    )
    parent_response = await client.post(
        "/jobs",
        json={"type": "system.noop", "idempotency_key": "parent"},
        headers=headers,
    )
    assert parent_response.status_code == 202, parent_response.text
    parent = parent_response.json()
    assert parent["operation_context"] == {
        "request_id": "request-123",
        "command_id": "command-parent",
        "correlation_id": "correlation-123",
        "causation_id": "http-parent",
        "actor_id": parent["created_by_id"],
    }

    child_payload = {
        "type": "system.noop",
        "payload": {"page": 1},
        "parent_job_id": parent["id"],
        "chunk_key": "page-1",
        "progress_total": 25,
    }
    child_response = await client.post("/jobs", json=child_payload, headers=headers)
    replay_response = await client.post("/jobs", json=child_payload, headers=headers)
    assert child_response.status_code == 202, child_response.text
    assert replay_response.json()["id"] == child_response.json()["id"]
    child = child_response.json()
    assert child["operation_context"]["request_id"] == "request-123"
    assert child["operation_context"]["correlation_id"] == "correlation-123"
    assert child["operation_context"]["causation_id"] == "command-parent"
    assert child["operation_context"]["command_id"] != "command-parent"

    children = await client.get(f"/jobs/{parent['id']}/children", headers=headers)
    assert [item["id"] for item in children.json()] == [child["id"]]

    mismatch = await client.post(
        "/jobs",
        json={**child_payload, "payload": {"page": 2}},
        headers=headers,
    )
    assert mismatch.status_code == 409
    assert mismatch.headers["content-type"].startswith("application/problem+json")
    assert mismatch.json()["code"] == "JOB_IDEMPOTENCY_KEY_REUSED"


@pytest.mark.asyncio
async def test_priority_aging_prevents_starvation(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "job-priority@example.com")
    low = (
        await client.post(
            "/jobs",
            json={"type": "system.noop", "priority": -10},
            headers=headers,
        )
    ).json()
    high = (
        await client.post(
            "/jobs",
            json={"type": "system.noop", "priority": 10},
            headers=headers,
        )
    ).json()

    session, generator = await _session()
    try:
        low_job = await session.get(Job, low["id"])
        high_job = await session.get(Job, high["id"])
        assert low_job is not None and high_job is not None
        low_job.created_at = datetime.now(UTC) - timedelta(minutes=30)
        await session.commit()

        claimed = await claim_next_job(session, worker_id="priority-worker", lease_seconds=60)
        assert claimed is not None
        assert str(claimed.id) == low["id"]
    finally:
        await generator.aclose()


@pytest.mark.asyncio
async def test_checkpoint_survives_retry_and_resume(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "job-resume@example.com")
    created = (
        await client.post(
            "/jobs",
            json={"type": "system.noop", "progress_total": 10, "max_attempts": 2},
            headers=headers,
        )
    ).json()

    session, generator = await _session()
    try:
        first = await claim_next_job(session, worker_id="resume-1", lease_seconds=60)
        assert first is not None
        await update_job_progress(
            session,
            first,
            current=4,
            message="Imported first batch",
            checkpoint={"cursor": "row-4"},
        )
        await fail_job(session, first, "temporary")
        first.run_after = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()

        resumed = await claim_next_job(session, worker_id="resume-2", lease_seconds=60)
        assert resumed is not None
        assert str(resumed.id) == created["id"]
        assert resumed.attempts == 2
        assert resumed.progress_current == 4
        assert resumed.progress_total == 10
        assert resumed.checkpoint == {"cursor": "row-4"}
    finally:
        await generator.aclose()


@pytest.mark.asyncio
async def test_running_job_cancellation_is_cooperative(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "job-cancel@example.com")
    queued = (
        await client.post("/jobs", json={"type": "system.noop"}, headers=headers)
    ).json()
    cancelled = await client.post(f"/jobs/{queued['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["completed_at"] is not None

    running = (
        await client.post("/jobs", json={"type": "system.noop"}, headers=headers)
    ).json()
    session, generator = await _session()
    try:
        claimed = await claim_next_job(session, worker_id="cancel-worker", lease_seconds=60)
        assert claimed is not None
        assert str(claimed.id) == running["id"]
    finally:
        await generator.aclose()

    requested = await client.post(f"/jobs/{running['id']}/cancel", headers=headers)
    assert requested.status_code == 200
    assert requested.json()["status"] == "running"
    assert requested.json()["cancellation_requested_at"] is not None

    session, generator = await _session()
    try:
        job = await session.get(Job, running["id"])
        assert job is not None
        context = JobExecutionContext(db=session, job=job, storage=None)  # type: ignore[arg-type]
        with pytest.raises(JobCancelledError):
            await context.raise_if_cancelled()
        await cancel_job_execution(session, job)
        assert job.status is JobStatus.cancelled
    finally:
        await generator.aclose()


@pytest.mark.asyncio
async def test_structured_failure_redacts_payload_secrets(
    client: httpx.AsyncClient,
) -> None:
    headers = await _register(client, "job-redaction@example.com")
    secret = "do-not-log-this"
    created = (
        await client.post(
            "/jobs",
            json={
                "type": "system.noop",
                "payload": {"password": secret, "safe": "visible"},
                "max_attempts": 1,
            },
            headers=headers,
        )
    ).json()

    session, generator = await _session()
    try:
        job = await claim_next_job(session, worker_id="redaction-worker", lease_seconds=60)
        assert job is not None
        error = structured_job_error(
            ValueError(f"password={secret}; invalid input"),
            job.payload,
        )
        await fail_job(session, job, error)
    finally:
        await generator.aclose()

    failed = (await client.get(f"/jobs/{created['id']}", headers=headers)).json()
    serialized_error = json.dumps(
        {"error": failed["error"], "error_details": failed["error_details"]}
    )
    assert secret not in serialized_error
    assert "[REDACTED]" in serialized_error
    assert failed["error_details"]["code"] == "VALUE_ERROR"
    assert failed["error_details"]["retryable"] is False


@pytest.mark.asyncio
async def test_metrics_expose_bounded_job_metadata_only(client: httpx.AsyncClient) -> None:
    headers = await _register(client, "job-metrics@example.com")
    secret = "metrics-must-not-contain-me"
    await client.post(
        "/jobs",
        json={"type": "system.noop", "payload": {"api_key": secret}},
        headers=headers,
    )

    response = await client.get("/metrics")
    assert response.status_code == 200
    assert 'vhb_job_backlog{type="system.noop",status="queued"} 1' in response.text
    assert "vhb_job_oldest_age_seconds" in response.text
    assert secret not in response.text
