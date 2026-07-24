"""Saved layout model — a database has many named layouts (Table/Board/Calendar…)."""

import enum
import uuid
from typing import Any

from sqlalchemy import Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class LayoutType(enum.StrEnum):
    table = "table"
    board = "board"
    calendar = "calendar"
    gallery = "gallery"
    gantt = "gantt"
    list = "list"


class Layout(Base, TimestampMixin):
    __tablename__ = "layouts"
    __table_args__ = (
        UniqueConstraint(
            "placement_id",
            "source_layout_id",
            name="uq_layout_placement_source",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    # NULL means this is a canonical Database layout. A non-NULL value makes
    # the layout private to one Space/Folder placement of that Database.
    placement_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "space_database_placements.id",
            ondelete="CASCADE",
            name="fk_layouts_placement_id",
        ),
        nullable=True,
        index=True,
    )
    # Placement layouts cloned from a canonical layout retain their origin for
    # traceability. Subsequent edits are independent and never sync back.
    source_layout_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("layouts.id", ondelete="SET NULL", name="fk_layouts_source_layout_id"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # VARCHAR enum (no migration needed to add a layout type later).
    type: Mapped[LayoutType] = mapped_column(
        Enum(LayoutType, native_enum=False, length=32, create_constraint=False),
        default=LayoutType.table,
    )
    # Free-form per-layout config (filters/sorts/group/hidden/frozen/calc/board_field…).
    # Frontend owns the shape; backend just stores it.
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)
    # Which saved View Preset is currently applied, if any. SET NULL on delete
    # so removing the active preset just falls back to "no preset active"
    # rather than blocking the delete or cascading into the Layout. Named
    # explicitly: layouts <-> view_presets is a circular FK (view_presets.
    # layout_id points back at layouts), and SQLAlchemy can only break that
    # cycle on drop_all if the constraint has a name to DROP CONSTRAINT by.
    active_view_preset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "view_presets.id", ondelete="SET NULL", name="fk_layouts_active_view_preset_id"
        ),
        nullable=True,
        index=True,
    )
