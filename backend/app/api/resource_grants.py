"""Generic resource grant management for databases, documents and future domains."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.deps.workspace import get_current_workspace
from app.models.dashboard import Dashboard
from app.models.database import Database
from app.models.document import Document
from app.models.permission import ResourceGrant, ResourceType
from app.models.site import Site
from app.models.user import User
from app.models.workspace import MemberRole, Workspace, WorkspaceMember
from app.schemas.permission import ResourceGrantOut, ResourceGrantUpsert
from app.services.authorization import Action, require_resource_action
from app.services.events import record_event
from app.services.notifications import create_notification

router = APIRouter(prefix="/resource-grants", tags=["resource-grants"])


async def _require_scoped_resource(
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    workspace: Workspace,
    db: AsyncSession,
) -> None:
    resource: Database | Document | Dashboard | Site | None
    if resource_type is ResourceType.database:
        resource = await db.get(Database, resource_id)
    elif resource_type is ResourceType.document:
        resource = await db.get(Document, resource_id)
    elif resource_type is ResourceType.dashboard:
        resource = await db.get(Dashboard, resource_id)
    else:
        resource = await db.get(Site, resource_id)
    if resource is None or resource.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")


async def _require_manager(
    *,
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    workspace: Workspace,
    current_user: User,
    db: AsyncSession,
) -> None:
    await _require_scoped_resource(resource_type, resource_id, workspace, db)
    await require_resource_action(
        db,
        resource_type=resource_type,
        resource_id=resource_id,
        workspace_id=workspace.id,
        user_id=current_user.id,
        action=Action.manage,
    )


@router.get(
    "/{resource_type}/{resource_id}",
    response_model=list[ResourceGrantOut],
)
async def list_resource_grants(
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ResourceGrant]:
    await _require_manager(
        resource_type=resource_type,
        resource_id=resource_id,
        workspace=workspace,
        current_user=current_user,
        db=db,
    )
    result = await db.execute(
        select(ResourceGrant)
        .where(
            ResourceGrant.workspace_id == workspace.id,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
        )
        .order_by(ResourceGrant.created_at)
    )
    return list(result.scalars())


@router.put(
    "/{resource_type}/{resource_id}",
    response_model=ResourceGrantOut,
)
async def upsert_resource_grant(
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    payload: ResourceGrantUpsert,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ResourceGrant:
    await _require_manager(
        resource_type=resource_type,
        resource_id=resource_id,
        workspace=workspace,
        current_user=current_user,
        db=db,
    )
    member = await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace.id,
            WorkspaceMember.user_id == payload.user_id,
        )
    )
    if member is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Workspace member required")
    if member.role is MemberRole.owner:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Owner access cannot be overridden"
        )
    grant = await db.scalar(
        select(ResourceGrant).where(
            ResourceGrant.workspace_id == workspace.id,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
            ResourceGrant.user_id == payload.user_id,
        )
    )
    if grant is None:
        grant = ResourceGrant(
            workspace_id=workspace.id,
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=payload.user_id,
            role=payload.role,
        )
        db.add(grant)
    else:
        grant.role = payload.role
    record_event(
        db,
        action="resource.grant_changed",
        resource_type=resource_type.value,
        resource_id=str(resource_id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"user_id": str(payload.user_id), "role": payload.role.value},
    )
    if payload.user_id != current_user.id:
        await create_notification(
            db,
            workspace_id=workspace.id,
            user_id=payload.user_id,
            notification_type="resource.grant_changed",
            title=f"{resource_type.value.title()} access updated",
            body=f"Your access role is now {payload.role.value}.",
            data={
                "resource_type": resource_type.value,
                "resource_id": str(resource_id),
                "role": payload.role.value,
            },
        )
    await db.commit()
    await db.refresh(grant)
    return grant


@router.delete(
    "/{resource_type}/{resource_id}/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_resource_grant(
    resource_type: ResourceType,
    resource_id: uuid.UUID,
    user_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _require_manager(
        resource_type=resource_type,
        resource_id=resource_id,
        workspace=workspace,
        current_user=current_user,
        db=db,
    )
    grant = await db.scalar(
        select(ResourceGrant).where(
            ResourceGrant.workspace_id == workspace.id,
            ResourceGrant.resource_type == resource_type,
            ResourceGrant.resource_id == resource_id,
            ResourceGrant.user_id == user_id,
        )
    )
    if grant is None:
        return
    await db.delete(grant)
    record_event(
        db,
        action="resource.grant_removed",
        resource_type=resource_type.value,
        resource_id=str(resource_id),
        workspace_id=workspace.id,
        actor_id=current_user.id,
        data={"user_id": str(user_id)},
    )
    await db.commit()
