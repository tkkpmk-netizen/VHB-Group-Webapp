"""Field (column definition) and Row (record) for the dynamic database engine."""

import enum
import uuid
from typing import Any

from sqlalchemy import Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class FieldType(enum.StrEnum):
    # --- Phase E1 (implemented) ---
    text = "text"
    long_text = "long_text"
    number = "number"  # options.format: plain | currency | percent
    checkbox = "checkbox"
    date = "date"
    url = "url"
    email = "email"
    phone = "phone"
    select = "select"  # options.choices[{id,label,color}]
    multi_select = "multi_select"
    status = "status"  # select + options.groups
    priority = "priority"  # preset select
    rating = "rating"  # number 1..5
    unique_id = "unique_id"  # auto, read-only; uses Row.seq + options.prefix
    # --- Reserved (later phases, no editor/validation yet) ---
    relation = "relation"


class Field(Base, TimestampMixin):
    __tablename__ = "fields"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    # Stored as VARCHAR (native_enum=False) so adding new field types never
    # needs a DB migration; still converts to/from FieldType in Python.
    type: Mapped[FieldType] = mapped_column(
        Enum(FieldType, native_enum=False, length=32, create_constraint=False)
    )
    # e.g. {"choices": [{"id": "...", "label": "High", "color": "#ef3826"}]}
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)


class Row(Base, TimestampMixin):
    __tablename__ = "rows"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    # Cell values keyed by field id (as string). JSONB for flexible schema.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Immutable per-database sequence (powers unique_id). Never reused.
    seq: Mapped[int] = mapped_column(Integer, default=0)
    # Mutable display position (drag-drop reorder).
    order: Mapped[int] = mapped_column(Integer, default=0)
