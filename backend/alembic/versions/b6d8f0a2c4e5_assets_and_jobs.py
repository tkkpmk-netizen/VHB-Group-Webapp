"""assets and durable jobs

Revision ID: b6d8f0a2c4e5
Revises: a5c7e9f1b3d4
Create Date: 2026-07-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b6d8f0a2c4e5"
down_revision: Union[str, Sequence[str], None] = "a5c7e9f1b3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("object_key", sa.String(length=1024), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index(op.f("ix_assets_created_by_id"), "assets", ["created_by_id"])
    op.create_index(op.f("ix_assets_workspace_id"), "assets", ["workspace_id"])

    op.create_table(
        "jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=False),
        sa.Column(
            "run_after",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked_by", sa.String(length=200), nullable=True),
        sa.Column("idempotency_key", sa.String(length=200), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["created_by_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "idempotency_key",
            name="uq_job_workspace_idempotency",
        ),
    )
    op.create_index(op.f("ix_jobs_created_by_id"), "jobs", ["created_by_id"])
    op.create_index(op.f("ix_jobs_run_after"), "jobs", ["run_after"])
    op.create_index(op.f("ix_jobs_status"), "jobs", ["status"])
    op.create_index(op.f("ix_jobs_type"), "jobs", ["type"])
    op.create_index(op.f("ix_jobs_workspace_id"), "jobs", ["workspace_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_jobs_workspace_id"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_type"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_status"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_run_after"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_created_by_id"), table_name="jobs")
    op.drop_table("jobs")
    op.drop_index(op.f("ix_assets_workspace_id"), table_name="assets")
    op.drop_index(op.f("ix_assets_created_by_id"), table_name="assets")
    op.drop_table("assets")
