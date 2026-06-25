"""Workspace-scoping dependency. Every data query must go through this."""

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember


async def get_current_workspace(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    """Resolve the caller's current workspace (MVP: their first membership)."""
    result = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id)
        .order_by(Workspace.created_at.asc())
        .limit(1)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No workspace found"
        )
    return workspace
