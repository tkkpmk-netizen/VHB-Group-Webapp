"""T3 migration staging and quality control

Revision ID: c3e1d9a7f4b2
Revises: b8d0f2a4c6e8
Create Date: 2026-08-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c3e1d9a7f4b2"
down_revision: str | None = "b8d0f2a4c6e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("migration_batches", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False), sa.Column("asset_id", sa.Uuid(), sa.ForeignKey("assets.id", ondelete="RESTRICT")), sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False), sa.Column("source_key", sa.String(200), nullable=False), sa.Column("source_label", sa.String(255), nullable=False), sa.Column("source_url", sa.String(2048)), sa.Column("source_checksum", sa.String(64), nullable=False), sa.Column("mapping_version", sa.Integer(), nullable=False, server_default="1"), sa.Column("status", sa.String(20), nullable=False, server_default="staged"), sa.Column("priority_cohort", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"), sa.Column("assigned_to_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("version", sa.Integer(), nullable=False, server_default="1"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.UniqueConstraint("workspace_id", "source_key", "source_checksum", name="uq_migration_batch_source"))
    op.create_table("migration_source_rows", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("migration_batches.id", ondelete="CASCADE"), nullable=False), sa.Column("source_locator", sa.String(500), nullable=False), sa.Column("source_url", sa.String(2048)), sa.Column("raw_values", postgresql.JSONB(), nullable=False), sa.Column("raw_checksum", sa.String(64), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.UniqueConstraint("batch_id", "source_locator", name="uq_migration_source_row_locator"))
    op.create_table("migration_candidates", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False), sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("migration_batches.id", ondelete="CASCADE"), nullable=False), sa.Column("source_row_id", sa.Uuid(), sa.ForeignKey("migration_source_rows.id", ondelete="CASCADE"), nullable=False), sa.Column("mapping_version", sa.Integer(), nullable=False), sa.Column("record_type", sa.String(50), nullable=False), sa.Column("normalized_values", postgresql.JSONB(), nullable=False), sa.Column("mapping_confidence", sa.Integer(), nullable=False), sa.Column("status", sa.String(20), nullable=False, server_default="pending"), sa.Column("trust_tier", sa.String(24), nullable=False, server_default="reference_only"), sa.Column("review_notes", sa.Text()), sa.Column("reviewed_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("reviewed_at", sa.DateTime(timezone=True)), sa.Column("version", sa.Integer(), nullable=False, server_default="1"), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.UniqueConstraint("source_row_id", "mapping_version", name="uq_migration_candidate_version"))
    op.create_table("migration_conflicts", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False), sa.Column("candidate_id", sa.Uuid(), sa.ForeignKey("migration_candidates.id", ondelete="CASCADE"), nullable=False), sa.Column("kind", sa.String(100), nullable=False), sa.Column("field_paths", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")), sa.Column("detail", sa.Text(), nullable=False), sa.Column("status", sa.String(16), nullable=False, server_default="open"), sa.Column("assigned_to_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("due_at", sa.DateTime(timezone=True)), sa.Column("resolution", sa.Text()), sa.Column("resolved_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")), sa.Column("resolved_at", sa.DateTime(timezone=True)), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")))
    op.create_table("migration_promotion_receipts", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False), sa.Column("candidate_id", sa.Uuid(), sa.ForeignKey("migration_candidates.id", ondelete="RESTRICT"), nullable=False), sa.Column("reviewer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False), sa.Column("trust_tier", sa.String(24), nullable=False), sa.Column("resulting_record_type", sa.String(50), nullable=False), sa.Column("resulting_snapshot", postgresql.JSONB(), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")), sa.UniqueConstraint("candidate_id", name="uq_migration_promotion_candidate"))
    for table, columns in (("migration_batches", ["workspace_id", "status", "priority_cohort"]), ("migration_source_rows", ["batch_id"]), ("migration_candidates", ["workspace_id", "batch_id", "source_row_id", "record_type", "status", "trust_tier"]), ("migration_conflicts", ["workspace_id", "candidate_id", "kind", "status", "assigned_to_id"]), ("migration_promotion_receipts", ["workspace_id", "candidate_id", "reviewer_id"])):
        for column in columns:
            op.create_index(op.f(f"ix_{table}_{column}"), table, [column])


def downgrade() -> None:
    for table in ("migration_promotion_receipts", "migration_conflicts", "migration_candidates", "migration_source_rows", "migration_batches"):
        op.drop_table(table)
