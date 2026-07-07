"""In-app notification inbox, unread state and preferences."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.notification import Notification
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.notification import (
    NotificationOut,
    NotificationPreferenceOut,
    NotificationPreferenceUpdate,
    UnreadCountOut,
)
from app.services.cache import CacheStore, get_cache_store
from app.services.notifications import (
    get_preferences,
    unread_cache_key,
    unread_count,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Notification]:
    preference = await get_preferences(db, workspace_id=workspace.id, user_id=current_user.id)
    if not preference.in_app_enabled:
        await db.commit()
        return []
    query = select(Notification).where(
        Notification.workspace_id == workspace.id,
        Notification.user_id == current_user.id,
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    result = await db.execute(query.order_by(Notification.created_at.desc()).limit(limit))
    return list(result.scalars())


@router.get("/unread-count", response_model=UnreadCountOut)
async def get_unread_count(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
) -> UnreadCountOut:
    preference = await get_preferences(db, workspace_id=workspace.id, user_id=current_user.id)
    if not preference.in_app_enabled:
        await db.commit()
        return UnreadCountOut(count=0)
    return UnreadCountOut(
        count=await unread_count(
            db,
            cache,
            workspace_id=workspace.id,
            user_id=current_user.id,
        )
    )


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_notification_read(
    notification_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
) -> Notification:
    notification = await db.get(Notification, notification_id)
    if (
        notification is None
        or notification.workspace_id != workspace.id
        or notification.user_id != current_user.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    notification.read_at = notification.read_at or datetime.now(UTC)
    await db.commit()
    await db.refresh(notification)
    await cache.delete(unread_cache_key(workspace.id, current_user.id))
    return notification


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
) -> None:
    await db.execute(
        update(Notification)
        .where(
            Notification.workspace_id == workspace.id,
            Notification.user_id == current_user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
    await cache.set(unread_cache_key(workspace.id, current_user.id), "0", 30)


@router.get("/preferences", response_model=NotificationPreferenceOut)
async def read_preferences(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferenceOut:
    preference = await get_preferences(db, workspace_id=workspace.id, user_id=current_user.id)
    await db.commit()
    return NotificationPreferenceOut.model_validate(preference)


@router.put("/preferences", response_model=NotificationPreferenceOut)
async def update_preferences(
    payload: NotificationPreferenceUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferenceOut:
    preference = await get_preferences(db, workspace_id=workspace.id, user_id=current_user.id)
    preference.in_app_enabled = payload.in_app_enabled
    preference.email_enabled = payload.email_enabled
    await db.commit()
    await db.refresh(preference)
    return NotificationPreferenceOut.model_validate(preference)
