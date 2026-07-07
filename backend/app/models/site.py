"""Site/page/data-binding models for Design & Publishing."""

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class Site(Base, TimestampMixin):
    __tablename__ = "sites"
    __table_args__ = (UniqueConstraint("slug", name="uq_site_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    updated_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(200), default="Untitled site")
    slug: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    homepage_path: Mapped[str] = mapped_column(String(255), default="/")
    published: Mapped[bool] = mapped_column(Boolean, default=False)


class SitePage(Base, TimestampMixin):
    __tablename__ = "site_pages"
    __table_args__ = (UniqueConstraint("site_id", "path", name="uq_site_page_path"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200), default="Untitled page")
    path: Mapped[str] = mapped_column(String(255), default="/")
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    order: Mapped[int] = mapped_column(Integer, default=0)


class SiteDataBinding(Base, TimestampMixin):
    __tablename__ = "site_data_bindings"
    __table_args__ = (UniqueConstraint("site_id", "key", name="uq_site_binding_key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    site_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), index=True
    )
    page_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("site_pages.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    database_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("databases.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(80))
    name: Mapped[str] = mapped_column(String(200))
    query: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    field_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    expose_public: Mapped[bool] = mapped_column(Boolean, default=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
