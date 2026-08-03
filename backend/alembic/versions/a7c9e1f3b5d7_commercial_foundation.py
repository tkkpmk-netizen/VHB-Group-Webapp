"""commercial foundation policy and command receipts

Revision ID: a7c9e1f3b5d7
Revises: f4a6c8e0b2d4
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a7c9e1f3b5d7"
down_revision: str | None = "f4a6c8e0b2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "commercial_workspace_policies",
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("cohort", sa.String(length=50), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("workspace_id"),
    )
    op.create_index(
        op.f("ix_commercial_workspace_policies_updated_by_id"),
        "commercial_workspace_policies",
        ["updated_by_id"],
    )
    op.create_table(
        "commercial_capability_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("capability", sa.String(length=100), nullable=False),
        sa.Column("subject_type", sa.String(length=16), nullable=False),
        sa.Column("subject_id", sa.String(length=200), nullable=False),
        sa.Column("allowed", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "capability",
            "subject_type",
            "subject_id",
            name="uq_commercial_capability_subject",
        ),
    )
    op.create_index(
        op.f("ix_commercial_capability_assignments_capability"),
        "commercial_capability_assignments",
        ["capability"],
    )
    op.create_index(
        op.f("ix_commercial_capability_assignments_updated_by_id"),
        "commercial_capability_assignments",
        ["updated_by_id"],
    )
    op.create_index(
        op.f("ix_commercial_capability_assignments_workspace_id"),
        "commercial_capability_assignments",
        ["workspace_id"],
    )
    op.create_table(
        "commercial_command_receipts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("command_name", sa.String(length=150), nullable=False),
        sa.Column("idempotency_key", sa.String(length=200), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=False),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "actor_id",
            "command_name",
            "idempotency_key",
            name="uq_commercial_command_receipt",
        ),
    )
    op.create_index(
        op.f("ix_commercial_command_receipts_actor_id"),
        "commercial_command_receipts",
        ["actor_id"],
    )
    op.create_index(
        op.f("ix_commercial_command_receipts_command_name"),
        "commercial_command_receipts",
        ["command_name"],
    )
    op.create_index(
        op.f("ix_commercial_command_receipts_created_at"),
        "commercial_command_receipts",
        ["created_at"],
    )
    op.create_index(
        op.f("ix_commercial_command_receipts_workspace_id"),
        "commercial_command_receipts",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_commercial_command_receipts_workspace_id"),
        table_name="commercial_command_receipts",
    )
    op.drop_index(
        op.f("ix_commercial_command_receipts_created_at"),
        table_name="commercial_command_receipts",
    )
    op.drop_index(
        op.f("ix_commercial_command_receipts_command_name"),
        table_name="commercial_command_receipts",
    )
    op.drop_index(
        op.f("ix_commercial_command_receipts_actor_id"),
        table_name="commercial_command_receipts",
    )
    op.drop_table("commercial_command_receipts")
    op.drop_index(
        op.f("ix_commercial_capability_assignments_workspace_id"),
        table_name="commercial_capability_assignments",
    )
    op.drop_index(
        op.f("ix_commercial_capability_assignments_updated_by_id"),
        table_name="commercial_capability_assignments",
    )
    op.drop_index(
        op.f("ix_commercial_capability_assignments_capability"),
        table_name="commercial_capability_assignments",
    )
    op.drop_table("commercial_capability_assignments")
    op.drop_index(
        op.f("ix_commercial_workspace_policies_updated_by_id"),
        table_name="commercial_workspace_policies",
    )
    op.drop_table("commercial_workspace_policies")
