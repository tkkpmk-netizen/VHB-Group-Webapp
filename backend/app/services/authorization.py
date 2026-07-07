"""Central authorization policy for workspace and generic resources."""

import enum
import uuid

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.permission import ResourceGrant, ResourceRole, ResourceType
from app.models.workspace import MemberRole, WorkspaceMember


class Action(enum.StrEnum):
    read = "read"
    write = "write"
    manage = "manage"


_WORKSPACE_ACTIONS = {
    MemberRole.owner: {Action.read, Action.write, Action.manage},
    MemberRole.admin: {Action.read, Action.write, Action.manage},
    MemberRole.editor: {Action.read, Action.write},
    MemberRole.member: {Action.read, Action.write},
    MemberRole.viewer: {Action.read},
}
_RESOURCE_ACTIONS = {
    ResourceRole.manager: {Action.read, Action.write, Action.manage},
    ResourceRole.editor: {Action.read, Action.write},
    ResourceRole.viewer: {Action.read},
}


async def require_workspace_action(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    action: Action,
) -> WorkspaceMember:
    membership = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if membership is None or action not in _WORKSPACE_ACTIONS[membership.role]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permission")
    return membership


async def require_resource_action(
    db: AsyncSession,
    *,
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    action: Action,
) -> None:
    membership = await require_workspace_action(
        db,
        workspace_id=workspace_id,
        user_id=user_id,
        action=Action.read,
    )
    if membership.role in {MemberRole.owner, MemberRole.admin}:
        return
    grant = await db.scalar(
        select(ResourceGrant).where(
            ResourceGrant.workspace_id == workspace_id,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
            ResourceGrant.user_id == user_id,
        )
    )
    allowed = _RESOURCE_ACTIONS[grant.role] if grant else _WORKSPACE_ACTIONS[membership.role]
    if action not in allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permission")


async def require_database_action(
    db: AsyncSession,
    *,
    database_id: uuid.UUID,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    action: Action,
) -> None:
    """Compatibility wrapper while database callers migrate to generic policy."""
    await require_resource_action(
        db,
        resource_type=ResourceType.database,
        resource_id=database_id,
        workspace_id=workspace_id,
        user_id=user_id,
        action=action,
    )


async def delete_resource_grants(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    resource_type: ResourceType,
    resource_id: uuid.UUID,
) -> None:
    """Remove polymorphic grants before deleting their parent resource."""
    await db.execute(
        delete(ResourceGrant).where(
            ResourceGrant.workspace_id == workspace_id,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
        )
    )
