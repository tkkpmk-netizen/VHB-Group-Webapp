"""Generic resource-scoped authorization models."""

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class ResourceRole(enum.StrEnum):
    viewer = "viewer"
    editor = "editor"
    manager = "manager"


class ResourceType(enum.StrEnum):
    database = "database"
    document = "document"
    dashboard = "dashboard"
    site = "site"


class ResourceGrant(Base, TimestampMixin):
    __tablename__ = "resource_grants"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "resource_type",
            "resource_id",
            "user_id",
            name="uq_resource_grant_user",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    resource_type: Mapped[ResourceType] = mapped_column(
        Enum(ResourceType, native_enum=False, length=32, create_constraint=False),
        index=True,
    )
    # Polymorphic resource id. Referential integrity is enforced by the
    # resource registry before writes; workspace_id keeps every query scoped.
    resource_id: Mapped[uuid.UUID] = mapped_column(index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[ResourceRole] = mapped_column(
        Enum(ResourceRole, native_enum=False, length=16, create_constraint=False)
    )
