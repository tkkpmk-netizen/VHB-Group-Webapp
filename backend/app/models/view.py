"""Saved view model — a database has many named views (Table/Board/Calendar…)."""

import enum
import uuid
from typing import Any

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class ViewType(enum.StrEnum):
    table = "table"
    board = "board"
    calendar = "calendar"
    gallery = "gallery"
    gantt = "gantt"


class View(Base, TimestampMixin):
    __tablename__ = "views"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    # VARCHAR enum (no migration needed to add a view type later).
    type: Mapped[ViewType] = mapped_column(
        Enum(ViewType, native_enum=False, length=32, create_constraint=False),
        default=ViewType.table,
    )
    # Free-form per-view config (filters/sorts/group/hidden/frozen/calc/board_field…).
    # Frontend owns the shape; backend just stores it.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)
