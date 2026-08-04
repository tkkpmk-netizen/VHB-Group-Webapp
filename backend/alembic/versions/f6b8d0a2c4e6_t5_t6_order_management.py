"""T5/T6 typed Order Management transactions

Revision ID: f6b8d0a2c4e6
Revises: e5a3c9d7f2b4
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f6b8d0a2c4e6"
down_revision: str | None = "e5a3c9d7f2b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def _index(table: str, *columns: str, unique: bool = False) -> None:
    op.create_index(f"ix_{table}_{'_'.join(columns)}", table, list(columns), unique=unique)


def upgrade() -> None:
    op.create_table(
        "commercial_inquiries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(60), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("customer_account_id", sa.Uuid(), nullable=True),
        sa.Column("customer_name", sa.String(300), nullable=False),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_account_id"], ["customer_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "number", name="uq_inquiry_number"),
    )
    for column in ("workspace_id", "customer_account_id", "source", "status", "owner_id"):
        _index("commercial_inquiries", column)

    op.create_table(
        "commercial_quotations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("inquiry_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(60), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["inquiry_id"], ["commercial_inquiries.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "number", name="uq_quotation_number"),
    )
    for column in ("workspace_id", "inquiry_id", "owner_id"):
        _index("commercial_quotations", column)

    op.create_table(
        "commercial_quotation_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("quotation_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("legal_profile", sa.String(50), nullable=False),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("lines", postgresql.JSONB(), nullable=False),
        sa.Column("subtotal", sa.Numeric(20, 4), nullable=False),
        sa.Column("total", sa.Numeric(20, 4), nullable=False),
        sa.Column("terms", postgresql.JSONB(), nullable=False),
        sa.Column("source_intake", postgresql.JSONB(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("approved_by_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_id"], ["commercial_quotations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("quotation_id", "version_no", name="uq_quotation_version"),
    )
    for column in ("workspace_id", "quotation_id", "status"):
        _index("commercial_quotation_versions", column)

    op.create_table(
        "commercial_evidence",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("record_type", sa.String(40), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("evidence_type", sa.String(60), nullable=False),
        sa.Column("source_key", sa.String(300), nullable=False),
        sa.Column("subject", sa.String(500), nullable=True),
        sa.Column("sender", sa.String(320), nullable=True),
        sa.Column("recipient", sa.String(1000), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(), nullable=False),
        sa.Column("captured_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["captured_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "source_key", name="uq_commercial_evidence_source"),
    )
    for column in ("workspace_id", "record_type", "record_id", "evidence_type", "occurred_at"):
        _index("commercial_evidence", column)

    op.create_table(
        "document_requirement_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("legal_profile", sa.String(50), nullable=False),
        sa.Column("transaction_type", sa.String(80), nullable=False),
        sa.Column("required_evidence_types", postgresql.JSONB(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "legal_profile", "transaction_type", "version", name="uq_document_requirement_profile_version"),
    )
    for column in ("workspace_id", "legal_profile", "transaction_type", "active"):
        _index("document_requirement_profiles", column)

    op.create_table(
        "payment_terms_versions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payment_method", sa.String(80), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("milestones", postgresql.JSONB(), nullable=False),
        sa.Column("allow_partial", sa.Boolean(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("approved_by_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "name", "version", name="uq_payment_terms_version"),
    )
    _index("payment_terms_versions", "workspace_id")
    _index("payment_terms_versions", "active")

    op.create_table(
        "commercial_sales_orders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(60), nullable=False),
        sa.Column("quotation_version_id", sa.Uuid(), nullable=False),
        sa.Column("requirement_profile_id", sa.Uuid(), nullable=False),
        sa.Column("payment_terms_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("customer_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("lines", postgresql.JSONB(), nullable=False),
        sa.Column("requirements_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("payment_terms_snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("total", sa.Numeric(20, 4), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_version_id"], ["commercial_quotation_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["requirement_profile_id"], ["document_requirement_profiles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["payment_terms_id"], ["payment_terms_versions.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["released_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "number", name="uq_sales_order_number"),
        sa.UniqueConstraint("quotation_version_id", name="uq_sales_order_quotation_version"),
    )
    for column in ("workspace_id", "quotation_version_id", "status"):
        _index("commercial_sales_orders", column)

    op.create_table(
        "payment_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("bank_reference", sa.String(200), nullable=False),
        sa.Column("amount", sa.Numeric(20, 4), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=False),
        sa.Column("receiving_account", sa.String(200), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("evidence_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_by_id", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["evidence_id"], ["commercial_evidence.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["confirmed_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("workspace_id", "bank_reference", name="uq_payment_receipt_bank_reference"),
    )
    _index("payment_receipts", "workspace_id")
    _index("payment_receipts", "status")

    op.create_table(
        "payment_allocations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("receipt_id", sa.Uuid(), nullable=False),
        sa.Column("sales_order_id", sa.Uuid(), nullable=False),
        sa.Column("milestone_id", sa.String(100), nullable=False),
        sa.Column("amount", sa.Numeric(20, 4), nullable=False),
        sa.Column("reversal_of_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["receipt_id"], ["payment_receipts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["sales_order_id"], ["commercial_sales_orders.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["reversal_of_id"], ["payment_allocations.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("reversal_of_id"),
    )
    for column in ("workspace_id", "receipt_id", "sales_order_id"):
        _index("payment_allocations", column)


def downgrade() -> None:
    for table in (
        "payment_allocations",
        "payment_receipts",
        "commercial_sales_orders",
        "payment_terms_versions",
        "document_requirement_profiles",
        "commercial_evidence",
        "commercial_quotation_versions",
        "commercial_quotations",
        "commercial_inquiries",
    ):
        op.drop_table(table)
