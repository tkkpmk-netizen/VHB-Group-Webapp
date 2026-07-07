"""identity accounts and notifications

Revision ID: 1a3c5e7f9b0d
Revises: f0b2d4e6a8c9
Create Date: 2026-07-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "1a3c5e7f9b0d"
down_revision: Union[str, Sequence[str], None] = "f0b2d4e6a8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("users", "hashed_password", existing_type=sa.String(255), nullable=True)
    op.create_table(
        "identity_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("provider_subject", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "profile",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "provider",
            "provider_subject",
            name="uq_identity_provider_subject",
        ),
        sa.UniqueConstraint("user_id", "provider", name="uq_identity_user_provider"),
    )
    op.create_index(
        op.f("ix_identity_accounts_provider"),
        "identity_accounts",
        ["provider"],
    )
    op.create_index(
        op.f("ix_identity_accounts_user_id"),
        "identity_accounts",
        ["user_id"],
    )
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notifications_created_at"), "notifications", ["created_at"])
    op.create_index(op.f("ix_notifications_type"), "notifications", ["type"])
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"])
    op.create_index(
        op.f("ix_notifications_workspace_id"),
        "notifications",
        ["workspace_id"],
    )
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("in_app_enabled", sa.Boolean(), nullable=False),
        sa.Column("email_enabled", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "user_id",
            name="uq_notification_preference_user",
        ),
    )
    op.create_index(
        op.f("ix_notification_preferences_user_id"),
        "notification_preferences",
        ["user_id"],
    )
    op.create_index(
        op.f("ix_notification_preferences_workspace_id"),
        "notification_preferences",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_table("notification_preferences")
    op.drop_table("notifications")
    op.drop_table("identity_accounts")
    op.execute(
        "UPDATE users SET hashed_password = 'disabled-oauth-account' WHERE hashed_password IS NULL"
    )
    op.alter_column("users", "hashed_password", existing_type=sa.String(255), nullable=False)
