"""Resource-scoped authorization models."""

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class ResourceRole(enum.StrEnum):
    viewer = "viewer"
    editor = "editor"
    manager = "manager"


class DatabaseGrant(Base, TimestampMixin):
    __tablename__ = "database_grants"
    __table_args__ = (UniqueConstraint("database_id", "user_id", name="uq_database_grant_user"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[ResourceRole] = mapped_column(
        Enum(ResourceRole, native_enum=False, length=16, create_constraint=False)
    )
