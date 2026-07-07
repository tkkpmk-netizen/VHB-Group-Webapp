"""Transactional audit + outbox event recording."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import AuditEvent, OutboxEvent
from app.models.job import Job
from app.models.notification import NotificationPreference


def record_event(
    db: AsyncSession,
    *,
    action: str,
    resource_type: str,
    resource_id: str | None,
    workspace_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    data: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    payload = data or {}
    db.add(
        AuditEvent(
            workspace_id=workspace_id,
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            data=payload,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    )
    db.add(
        OutboxEvent(
            workspace_id=workspace_id,
            topic=action,
            aggregate_type=resource_type,
            aggregate_id=resource_id,
            payload=payload,
        )
    )


async def publish_next_outbox_event(db: AsyncSession) -> OutboxEvent | None:
    """Mark the next local outbox event published.

    External transports can replace this publisher while preserving the
    transactional outbox contract.
    """
    event = await db.scalar(
        select(OutboxEvent)
        .where(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if event is None:
        return None
    event.attempts += 1
    if event.topic == "notification.created" and event.workspace_id is not None:
        notification_id = event.payload.get("notification_id")
        user_id = event.payload.get("user_id")
        if notification_id and user_id:
            parsed_user_id = uuid.UUID(str(user_id))
            preference = await db.scalar(
                select(NotificationPreference).where(
                    NotificationPreference.workspace_id == event.workspace_id,
                    NotificationPreference.user_id == parsed_user_id,
                    NotificationPreference.email_enabled.is_(True),
                )
            )
            if preference is not None:
                db.add(
                    Job(
                        workspace_id=event.workspace_id,
                        created_by_id=parsed_user_id,
                        type="notification.email",
                        payload={"notification_id": str(notification_id)},
                        max_attempts=3,
                        idempotency_key=f"notification-email:{notification_id}",
                    )
                )
    event.published_at = datetime.now(UTC)
    await db.commit()
    return event
