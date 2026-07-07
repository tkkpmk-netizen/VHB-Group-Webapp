"""User account model."""

import uuid
from typing import Any

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)


class IdentityAccount(Base, TimestampMixin):
    __tablename__ = "identity_accounts"
    __table_args__ = (
        UniqueConstraint("provider", "provider_subject", name="uq_identity_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_identity_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    provider: Mapped[str] = mapped_column(String(32), index=True)
    provider_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(320))
    profile: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
