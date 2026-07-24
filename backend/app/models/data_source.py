"""DataSource — groups Entities by import batch or manual origin within a Database."""

import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class DataSourceKind(enum.StrEnum):
    manual = "manual"
    imported = "imported"


class DataSource(Base, TimestampMixin):
    __tablename__ = "data_sources"
    __table_args__ = (
        # At most one primary (default/fallback) source per database — the
        # target for manual entity creation when no data_source_id is given.
        Index(
            "uq_data_source_primary_per_database",
            "database_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[DataSourceKind] = mapped_column(
        Enum(DataSourceKind, native_enum=False, length=16, create_constraint=False),
        default=DataSourceKind.manual,
    )
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    origin_asset_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    origin_job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order: Mapped[int] = mapped_column(Integer, default=0)
