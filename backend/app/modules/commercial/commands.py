"""Atomic, durable execution for Commercial commands."""

import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.problems import ProblemDetailsError
from app.models.commercial import CommercialCommandReceipt

CommandHandler = Callable[[], Awaitable[dict[str, Any]]]


def canonical_request_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _advisory_lock_key(
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    command_name: str,
    idempotency_key: str,
) -> int:
    digest = hashlib.sha256(
        f"{workspace_id}:{actor_id}:{command_name}:{idempotency_key}".encode()
    ).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


async def execute_commercial_command(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    command_name: str,
    idempotency_key: str,
    request_payload: dict[str, Any],
    handler: CommandHandler,
) -> tuple[dict[str, Any], bool]:
    """Own the only commit/rollback boundary for a Commercial command."""
    request_hash = canonical_request_hash(request_payload)
    try:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(:lock_key)"),
            {
                "lock_key": _advisory_lock_key(
                    workspace_id,
                    actor_id,
                    command_name,
                    idempotency_key,
                )
            },
        )
        receipt = await db.scalar(
            select(CommercialCommandReceipt).where(
                CommercialCommandReceipt.workspace_id == workspace_id,
                CommercialCommandReceipt.actor_id == actor_id,
                CommercialCommandReceipt.command_name == command_name,
                CommercialCommandReceipt.idempotency_key == idempotency_key,
            )
        )
        if receipt is not None:
            if receipt.request_hash != request_hash:
                raise ProblemDetailsError(
                    status=409,
                    code="IDEMPOTENCY_KEY_REUSED",
                    title="Idempotency key reused",
                    detail="This idempotency key was already used for a different payload.",
                    problem_type="https://vhb.local/problems/idempotency-key-reused",
                )
            await db.commit()
            return dict(receipt.response_payload), True

        response_payload = await handler()
        db.add(
            CommercialCommandReceipt(
                workspace_id=workspace_id,
                actor_id=actor_id,
                command_name=command_name,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response_status=200,
                response_payload=response_payload,
            )
        )
        await db.commit()
        return response_payload, False
    except Exception:
        await db.rollback()
        raise


def version_conflict(
    *,
    expected_version: int,
    current_version: int,
    changed_fields: list[str],
) -> ProblemDetailsError:
    return ProblemDetailsError(
        status=409,
        code="VERSION_CONFLICT",
        title="Version conflict",
        detail="The Commercial policy changed after this edit was opened.",
        problem_type="https://vhb.local/problems/version-conflict",
        extra={
            "conflict": {
                "code": "VERSION_CONFLICT",
                "expected_version": expected_version,
                "current_version": current_version,
                "changed_fields": [{"path": path} for path in changed_fields],
                "rebase_actions": ["refresh", "compare", "retry"],
            }
        },
    )
