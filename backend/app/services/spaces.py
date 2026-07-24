"""Helpers for creating Space-owned resources consistently."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard import Dashboard
from app.models.resource import Space


async def create_space_with_dashboard(
    db: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    name: str,
    order: int,
    icon: str | None = None,
    color: str | None = None,
) -> Space:
    """Create a Space and the default dashboard that opens for it."""

    space = Space(
        workspace_id=workspace_id,
        name=name,
        icon=icon,
        color=color,
        order=order,
    )
    db.add(space)
    await db.flush()
    db.add(
        Dashboard(
            workspace_id=workspace_id,
            space_id=space.id,
            created_by_id=user_id,
            updated_by_id=user_id,
            name="Overview",
            is_default=True,
        )
    )
    return space
