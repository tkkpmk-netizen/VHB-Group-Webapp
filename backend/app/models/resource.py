"""Workspace resource tree: spaces and nested folders."""

import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Space(Base, TimestampMixin):
    __tablename__ = "spaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    order: Mapped[int] = mapped_column(Integer, default=0)


class Folder(Base, TimestampMixin):
    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    order: Mapped[int] = mapped_column(Integer, default=0)
