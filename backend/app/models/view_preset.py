"""ViewPreset — a named, saved snapshot of a Layout's filter/sort/group state."""

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class ViewPreset(Base, TimestampMixin):
    __tablename__ = "view_presets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    layout_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("layouts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    # FilterGroup shape ({conj, rules}) — frontend owns it, same "backend just
    # stores it" contract as Layout.config.
    filter: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    sorts: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    # A Field.id, or a pseudo-field like "seq" — loose string, not an FK, same
    # convention as EntityFilter.field_id/EntitySort.field_id.
    group_field_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hide_empty: Mapped[bool] = mapped_column(Boolean, default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
