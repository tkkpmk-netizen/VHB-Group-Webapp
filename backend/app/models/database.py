"""User-created "Database" (a Notion-style table definition)."""

import uuid

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Database(Base, TimestampMixin):
    __tablename__ = "databases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # A short, editable explanation shown below the database title.  It is a
    # database attribute rather than a layout setting, so every layout has the
    # same context.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order: Mapped[int] = mapped_column(Integer, default=0)

    @property
    def is_favorite(self) -> bool:
        """Request-scoped presentation flag populated by list_databases."""

        return bool(self.__dict__.get("_is_favorite", False))

    @is_favorite.setter
    def is_favorite(self, value: bool) -> None:
        self.__dict__["_is_favorite"] = value
