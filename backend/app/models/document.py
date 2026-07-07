"""Block document model."""

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Document(Base, TimestampMixin):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    title: Mapped[str] = mapped_column(String(255), default="Untitled")
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    content: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    version: Mapped[int] = mapped_column(Integer, default=1)
