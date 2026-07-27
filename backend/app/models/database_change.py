"""Reversible database change records used by History and Undo."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid


class DatabaseChange(Base):
    __tablename__ = "database_changes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(100), index=True)
    summary: Mapped[str] = mapped_column(Text)
    # ``before`` contains the minimum resource snapshots needed to reverse
    # the operation. ``created`` contains ids that must be removed on restore.
    before: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created: Mapped[dict[str, list[str]]] = mapped_column(JSONB, default=dict)
    reverted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    reverted_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
