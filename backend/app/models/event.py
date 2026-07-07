"""Immutable audit records and transactional outbox events."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(150), index=True)
    resource_type: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class OutboxEvent(Base, TimestampMixin):
    __tablename__ = "outbox_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    topic: Mapped[str] = mapped_column(String(150), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(100))
    aggregate_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
