"""Workspace audit-log API."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.event import AuditEvent
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.event import AuditEventOut
from app.services.authorization import Action, require_workspace_action

router = APIRouter(prefix="/audit-events", tags=["audit"])


@router.get("", response_model=list[AuditEventOut])
async def list_audit_events(
    action: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AuditEvent]:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    query = select(AuditEvent).where(AuditEvent.workspace_id == workspace.id)
    if action:
        query = query.where(AuditEvent.action == action)
    result = await db.execute(
        query.order_by(AuditEvent.created_at.desc()).offset(offset).limit(limit)
    )
    return list(result.scalars())
