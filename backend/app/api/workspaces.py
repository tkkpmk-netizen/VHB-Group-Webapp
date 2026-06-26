"""Workspace routes."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.workspace import get_current_workspace
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import MemberOut, WorkspaceOut

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/me", response_model=WorkspaceOut)
async def my_workspace(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    count = await db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace.id)
    )
    return WorkspaceOut(
        id=workspace.id, name=workspace.name, member_count=count or 0
    )


@router.get("/me/members", response_model=list[MemberOut])
async def my_workspace_members(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    result = await db.execute(
        select(User)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace.id)
        .order_by(User.created_at.asc())
    )
    return list(result.scalars().all())
