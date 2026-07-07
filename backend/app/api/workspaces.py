"""Workspace routes."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.workspace import (
    MemberAdd,
    MemberOut,
    MemberRoleUpdate,
    MembershipOut,
    WorkspaceOut,
)
from app.services.authorization import Action, require_workspace_action
from app.services.events import record_event
from app.services.notifications import create_notification

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[MembershipOut])
async def list_my_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MembershipOut]:
    result = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id)
        .order_by(Workspace.created_at)
    )
    return [
        MembershipOut(id=workspace.id, name=workspace.name, role=role)
        for workspace, role in result.all()
    ]


@router.get("/me", response_model=WorkspaceOut)
async def my_workspace(
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    count = await db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace.id)
    )
    membership = await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.read,
    )
    return WorkspaceOut(
        id=workspace.id,
        name=workspace.name,
        member_count=count or 0,
        role=membership.role,
    )


@router.get("/me/members", response_model=list[MemberOut])
async def my_workspace_members(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut]:
    result = await db.execute(
        select(User, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace.id)
        .order_by(User.created_at.asc())
    )
    return [
        MemberOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=role,
        )
        for user, role in result.all()
    ]


@router.post(
    "/me/members",
    response_model=MemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_workspace_member(
    payload: MemberAdd,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    if payload.role.value == "owner":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Use a dedicated ownership-transfer flow",
        )
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    existing = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user.id,
        )
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "User is already a member")
    membership = WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=payload.role)
    db.add(membership)
    record_event(
        db,
        action="workspace.member_added",
        resource_type="workspace_member",
        resource_id=str(user.id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"role": payload.role.value, "email": user.email},
    )
    await create_notification(
        db,
        workspace_id=workspace.id,
        user_id=user.id,
        notification_type="workspace.member_added",
        title=f"You joined {workspace.name}",
        body=f"You were added to {workspace.name} as {payload.role.value}.",
        data={"workspace_id": str(workspace.id), "role": payload.role.value},
    )
    await db.commit()
    return MemberOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
    )


@router.patch("/me/members/{user_id}", response_model=MemberOut)
async def update_member_role(
    user_id: uuid.UUID,
    payload: MemberRoleUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    actor = await require_workspace_action(
        db,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )
    membership = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if membership.role.value == "owner" or payload.role.value == "owner":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Workspace ownership cannot be changed through this endpoint",
        )
    if actor.user_id == user_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "You cannot change your own role",
        )
    membership.role = payload.role
    user = await db.get(User, user_id)
    assert user is not None
    record_event(
        db,
        action="workspace.member_role_changed",
        resource_type="workspace_member",
        resource_id=str(user_id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"role": payload.role.value},
    )
    await db.commit()
    return MemberOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
    )
