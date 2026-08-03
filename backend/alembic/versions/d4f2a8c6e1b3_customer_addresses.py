"""customer addresses for reviewable master data UI

Revision ID: d4f2a8c6e1b3
Revises: a5c957f239d9
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4f2a8c6e1b3"
down_revision: str | None = "a5c957f239d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customer_addresses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("customer_account_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("line_1", sa.String(length=300), nullable=False),
        sa.Column("line_2", sa.String(length=300), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("region", sa.String(length=120), nullable=True),
        sa.Column("postal_code", sa.String(length=30), nullable=True),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
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
            ["customer_account_id"], ["customer_accounts.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_addresses_workspace_id", "customer_addresses", ["workspace_id"])
    op.create_index(
        "ix_customer_addresses_customer_account_id",
        "customer_addresses",
        ["customer_account_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_customer_addresses_customer_account_id", table_name="customer_addresses")
    op.drop_index("ix_customer_addresses_workspace_id", table_name="customer_addresses")
    op.drop_table("customer_addresses")
