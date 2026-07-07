"""Explicit workspace-scoping and membership dependencies."""

import uuid

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.deps.auth import get_current_user
from app.models.permission import ResourceType
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.services.authorization import (
    Action,
    require_resource_action,
    require_workspace_action,
)


async def get_current_workspace(
    request: Request,
    workspace_id: uuid.UUID | None = Header(default=None, alias="X-Workspace-ID"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    """Resolve an explicitly selected workspace.

    A missing header remains convenient for single-workspace accounts. Accounts
    with multiple memberships must choose, preventing accidental cross-tenant
    operations through an implicit "first workspace" rule.
    """
    memberships = await db.execute(
        select(Workspace)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id)
        .order_by(Workspace.created_at.asc())
    )
    workspaces = list(memberships.scalars().all())
    if not workspaces:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No workspace found")
    if workspace_id is None:
        if len(workspaces) > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Workspace-ID is required for multi-workspace accounts",
            )
        selected_workspace: Workspace | None = workspaces[0]
    else:
        selected_workspace = next((item for item in workspaces if item.id == workspace_id), None)
    if selected_workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    # Notification mutations only affect the authenticated user's own inbox and
    # preferences, so workspace viewers may perform them.
    action = (
        Action.read
        if request.method == "GET" or request.url.path.startswith("/notifications")
        else Action.write
    )
    database_id: uuid.UUID | None = None
    resource_type: ResourceType | None = None
    resource_id: uuid.UUID | None = None
    raw_database_id = request.path_params.get("database_id")
    if raw_database_id:
        database_id = uuid.UUID(str(raw_database_id))
    elif raw_field_id := request.path_params.get("field_id"):
        from app.models.field import Field

        field = await db.get(Field, uuid.UUID(str(raw_field_id)))
        database_id = field.database_id if field else None
    elif raw_row_id := request.path_params.get("row_id"):
        from app.models.field import Row

        row = await db.get(Row, uuid.UUID(str(raw_row_id)))
        database_id = row.database_id if row else None
    if database_id is not None:
        resource_type = ResourceType.database
        resource_id = database_id
    elif raw_document_id := request.path_params.get("document_id"):
        resource_type = ResourceType.document
        resource_id = uuid.UUID(str(raw_document_id))
    elif raw_dashboard_id := request.path_params.get("dashboard_id"):
        resource_type = ResourceType.dashboard
        resource_id = uuid.UUID(str(raw_dashboard_id))
    elif raw_site_id := request.path_params.get("site_id"):
        resource_type = ResourceType.site
        resource_id = uuid.UUID(str(raw_site_id))
    elif raw_page_id := request.path_params.get("page_id"):
        from app.models.site import SitePage

        page = await db.get(SitePage, uuid.UUID(str(raw_page_id)))
        resource_type = ResourceType.site
        resource_id = page.site_id if page else None
    elif raw_binding_id := request.path_params.get("binding_id"):
        from app.models.site import SiteDataBinding

        binding = await db.get(SiteDataBinding, uuid.UUID(str(raw_binding_id)))
        resource_type = ResourceType.site
        resource_id = binding.site_id if binding else None
    elif (raw_resource_type := request.path_params.get("resource_type")) and (
        raw_resource_id := request.path_params.get("resource_id")
    ):
        resource_type = ResourceType(str(raw_resource_type))
        resource_id = uuid.UUID(str(raw_resource_id))

    if resource_type is not None and resource_id is not None:
        await require_resource_action(
            db,
            resource_type=resource_type,
            resource_id=resource_id,
            workspace_id=selected_workspace.id,
            user_id=current_user.id,
            action=action,
        )
    else:
        await require_workspace_action(
            db,
            workspace_id=selected_workspace.id,
            user_id=current_user.id,
            action=action,
        )
    return selected_workspace
