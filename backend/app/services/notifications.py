"""Notification creation and Redis-backed unread counters."""

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import OutboxEvent
from app.models.notification import Notification, NotificationPreference
from app.services.cache import CacheStore


def unread_cache_key(workspace_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return f"notifications:unread:{workspace_id}:{user_id}"


async def create_notification(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    notification_type: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> Notification:
    notification = Notification(
        workspace_id=workspace_id,
        user_id=user_id,
        type=notification_type,
        title=title,
        body=body,
        data=data or {},
    )
    db.add(notification)
    await db.flush()
    db.add(
        OutboxEvent(
            workspace_id=workspace_id,
            topic="notification.created",
            aggregate_type="notification",
            aggregate_id=str(notification.id),
            payload={
                "notification_id": str(notification.id),
                "user_id": str(user_id),
            },
        )
    )
    return notification


async def get_preferences(
    db: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> NotificationPreference:
    preference = await db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.workspace_id == workspace_id,
            NotificationPreference.user_id == user_id,
        )
    )
    if preference is None:
        preference = NotificationPreference(
            workspace_id=workspace_id,
            user_id=user_id,
            in_app_enabled=True,
            email_enabled=False,
        )
        db.add(preference)
        await db.flush()
    return preference


async def unread_count(
    db: AsyncSession,
    cache: CacheStore,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> int:
    key = unread_cache_key(workspace_id, user_id)
    cached = await cache.get(key)
    if cached is not None:
        return int(cached)
    count = int(
        await db.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.workspace_id == workspace_id,
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
        )
        or 0
    )
    await cache.set(key, str(count), 30)
    return count
