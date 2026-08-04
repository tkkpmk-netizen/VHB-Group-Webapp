"""Connect Order Management documents to dynamic commercial masters.

Revision ID: f7c9e1b3d5a7
Revises: f6b8d0a2c4e6
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f7c9e1b3d5a7"
down_revision: str | None = "f6b8d0a2c4e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "commercial_inquiries",
        sa.Column("customer_entity_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_commercial_inquiries_customer_entity_id_entities",
        "commercial_inquiries",
        "entities",
        ["customer_entity_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_commercial_inquiries_customer_entity_id",
        "commercial_inquiries",
        ["customer_entity_id"],
    )
    op.add_column(
        "commercial_inquiries",
        sa.Column(
            "supplier_entity_ids",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "commercial_inquiries",
        sa.Column(
            "product_requests",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.create_table(
        "commercial_master_references",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("record_type", sa.String(40), nullable=False),
        sa.Column("record_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(24), nullable=False),
        sa.Column("line_index", sa.Integer(), nullable=True),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["entity_id"], ["entities.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "record_type", "record_id", "role", "line_index", "entity_id",
            name="uq_commercial_master_reference",
        ),
    )
    for column in ("workspace_id", "record_type", "record_id", "role", "entity_id"):
        op.create_index(
            f"ix_commercial_master_references_{column}",
            "commercial_master_references",
            [column],
        )


def downgrade() -> None:
    for column in ("entity_id", "role", "record_id", "record_type", "workspace_id"):
        op.drop_index(f"ix_commercial_master_references_{column}", table_name="commercial_master_references")
    op.drop_table("commercial_master_references")
    op.drop_column("commercial_inquiries", "product_requests")
    op.drop_column("commercial_inquiries", "supplier_entity_ids")
    op.drop_index("ix_commercial_inquiries_customer_entity_id", table_name="commercial_inquiries")
    op.drop_constraint(
        "fk_commercial_inquiries_customer_entity_id_entities",
        "commercial_inquiries",
        type_="foreignkey",
    )
    op.drop_column("commercial_inquiries", "customer_entity_id")
