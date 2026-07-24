"""Dashboard and query-bound widget models."""

import enum
import uuid
from typing import Any

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class WidgetType(enum.StrEnum):
    metric = "metric"
    bar = "bar"
    table = "table"


class Dashboard(Base, TimestampMixin):
    __tablename__ = "dashboards"
    __table_args__ = (
        Index(
            "uq_dashboards_default_per_space",
            "space_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200), default="Untitled dashboard")
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class DashboardWidget(Base, TimestampMixin):
    __tablename__ = "dashboard_widgets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), index=True
    )
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    type: Mapped[WidgetType] = mapped_column(
        Enum(WidgetType, native_enum=False, length=24, create_constraint=False)
    )
    query: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    visualization: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)
