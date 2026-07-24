"""Field (column definition) and Entity (record) for the dynamic database engine."""

import enum
import uuid
from typing import Any

from sqlalchemy import Enum, ForeignKey, Integer, String, UniqueConstraint
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
    country = "country"  # ISO country code string
    unique_id = "unique_id"  # auto, read-only; uses Entity.seq + options.prefix
    relation = "relation"  # links to entities of another database (EntityLink)
    rollup = "rollup"  # computed aggregate over a relation field
    formula = "formula"  # computed expression (asteval), options.expression
    people = "people"  # array of workspace user ids
    progress = "progress"  # number 0..100 (manual), shown as a bar
    created_time = "created_time"  # auto, read-only = Entity.created_at
    created_by = "created_by"  # auto, set to creator on insert
    last_edited_time = "last_edited_time"  # auto, read-only = Entity.updated_at
    last_edited_by = "last_edited_by"  # auto, set to editor on insert+update
    files = "files"  # Google Drive-backed attachment metadata


class Field(Base, TimestampMixin):
    __tablename__ = "fields"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Stored as VARCHAR (native_enum=False) so adding new field types never
    # needs a DB migration; still converts to/from FieldType in Python.
    type: Mapped[FieldType] = mapped_column(
        Enum(FieldType, native_enum=False, length=32, create_constraint=False)
    )
    # e.g. {"choices": [{"id": "...", "label": "High", "color": "#ef3826"}]}
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    order: Mapped[int] = mapped_column(Integer, default=0)


class EntityLink(Base, TimestampMixin):
    """A link for a relation field. One link-set per owner relation field.

    The owner field stores links (source = owner-side entity, target =
    other-side entity). A two-way "mirror" field reads the same links in
    reverse.
    """

    __tablename__ = "entity_links"
    __table_args__ = (
        UniqueConstraint(
            "field_id", "source_entity_id", "target_entity_id", name="uq_entity_link"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    # The OWNER relation field id (mirror fields reference it via options).
    field_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("fields.id", ondelete="CASCADE"), index=True
    )
    source_entity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )
    target_entity_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("entities.id", ondelete="CASCADE"), index=True
    )


class Entity(Base, TimestampMixin):
    __tablename__ = "entities"
    # seq is allocated under a per-database advisory lock (see
    # app.services.engine.next_entity_seq); the constraint is the backstop
    # against concurrent duplicates.
    __table_args__ = (
        UniqueConstraint("database_id", "seq", name="uq_entity_database_seq"),
        UniqueConstraint("database_id", "uid", name="uq_entity_database_uid"),
        UniqueConstraint("database_id", "name", name="uq_entity_database_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    # Which imported/manual source this entity belongs to. RESTRICT so a
    # source can't be deleted out from under entities that still reference it
    # (see app.api.data_sources.delete_data_source's 409 pre-check).
    data_source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("data_sources.id", ondelete="RESTRICT"), index=True
    )
    # Cell values keyed by field id (as string). JSONB for flexible schema.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Stable system identity.  `uid` is generated from the immutable sequence;
    # `name` is required and is mirrored into the built-in Name field.
    uid: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(200))
    # Immutable per-database sequence (powers unique_id). Never reused.
    seq: Mapped[int] = mapped_column(Integer, default=0)
    # Mutable display position (drag-drop reorder).
    order: Mapped[int] = mapped_column(Integer, default=0)
