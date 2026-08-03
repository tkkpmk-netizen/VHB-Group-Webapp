"""T0J durable job execution and observability

Revision ID: b8d0f2a4c6e8
Revises: a7c9e1f3b5d7
Create Date: 2026-07-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b8d0f2a4c6e8"
down_revision: str | None = "a7c9e1f3b5d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("parent_job_id", sa.Uuid(), nullable=True))
    op.add_column("jobs", sa.Column("chunk_key", sa.String(length=200), nullable=True))
    op.add_column(
        "jobs",
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "jobs",
        sa.Column("progress_current", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("jobs", sa.Column("progress_total", sa.Integer(), nullable=True))
    op.add_column(
        "jobs", sa.Column("progress_message", sa.String(length=500), nullable=True)
    )
    op.add_column(
        "jobs",
        sa.Column(
            "checkpoint",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "jobs",
        sa.Column("error_details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "jobs",
        sa.Column(
            "operation_context",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column("jobs", sa.Column("request_hash", sa.String(length=64), nullable=True))
    op.add_column(
        "jobs",
        sa.Column("cancellation_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "jobs", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "jobs", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "jobs", sa.Column("last_progress_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.execute(
        """
        UPDATE jobs
        SET operation_context = jsonb_build_object(
            'request_id', 'legacy:' || id::text,
            'command_id', 'legacy:' || id::text,
            'correlation_id', 'legacy:' || id::text,
            'causation_id', NULL,
            'actor_id', created_by_id::text
        )
        WHERE operation_context = '{}'::jsonb
        """
    )
    op.create_foreign_key(
        "fk_jobs_parent_job_id_jobs",
        "jobs",
        "jobs",
        ["parent_job_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_job_parent_chunk",
        "jobs",
        ["parent_job_id", "chunk_key"],
    )
    op.create_check_constraint(
        "ck_job_priority_range", "jobs", "priority BETWEEN -10 AND 10"
    )
    op.create_check_constraint(
        "ck_job_progress_current", "jobs", "progress_current >= 0"
    )
    op.create_check_constraint(
        "ck_job_progress_total",
        "jobs",
        "progress_total IS NULL OR progress_total >= 0",
    )
    op.create_check_constraint(
        "ck_job_progress_bounds",
        "jobs",
        "progress_total IS NULL OR progress_current <= progress_total",
    )
    op.create_check_constraint(
        "ck_job_parent_chunk_pair",
        "jobs",
        "(parent_job_id IS NULL AND chunk_key IS NULL) OR "
        "(parent_job_id IS NOT NULL AND chunk_key IS NOT NULL)",
    )
    op.create_index(op.f("ix_jobs_parent_job_id"), "jobs", ["parent_job_id"])
    op.create_index(op.f("ix_jobs_priority"), "jobs", ["priority"])
    op.create_index(
        op.f("ix_jobs_cancellation_requested_at"),
        "jobs",
        ["cancellation_requested_at"],
    )
    op.create_index(op.f("ix_jobs_completed_at"), "jobs", ["completed_at"])
    op.create_index(
        "ix_jobs_claim_order",
        "jobs",
        ["status", "run_after", "priority", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_jobs_claim_order", table_name="jobs")
    op.drop_index(op.f("ix_jobs_completed_at"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_cancellation_requested_at"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_priority"), table_name="jobs")
    op.drop_index(op.f("ix_jobs_parent_job_id"), table_name="jobs")
    op.drop_constraint("ck_job_parent_chunk_pair", "jobs", type_="check")
    op.drop_constraint("ck_job_progress_bounds", "jobs", type_="check")
    op.drop_constraint("ck_job_progress_total", "jobs", type_="check")
    op.drop_constraint("ck_job_progress_current", "jobs", type_="check")
    op.drop_constraint("ck_job_priority_range", "jobs", type_="check")
    op.drop_constraint("uq_job_parent_chunk", "jobs", type_="unique")
    op.drop_constraint("fk_jobs_parent_job_id_jobs", "jobs", type_="foreignkey")
    for column in (
        "last_progress_at",
        "completed_at",
        "started_at",
        "cancellation_requested_at",
        "request_hash",
        "operation_context",
        "error_details",
        "checkpoint",
        "progress_message",
        "progress_total",
        "progress_current",
        "priority",
        "chunk_key",
        "parent_job_id",
    ):
        op.drop_column("jobs", column)
