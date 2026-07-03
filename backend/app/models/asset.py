"""Object-storage asset metadata."""

import enum
import uuid

from sqlalchemy import BigInteger, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class AssetStatus(enum.StrEnum):
    pending = "pending"
    ready = "ready"
    failed = "failed"


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    object_key: Mapped[str] = mapped_column(String(1024), unique=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[AssetStatus] = mapped_column(
        Enum(AssetStatus, native_enum=False, length=16, create_constraint=False),
        default=AssetStatus.pending,
    )
