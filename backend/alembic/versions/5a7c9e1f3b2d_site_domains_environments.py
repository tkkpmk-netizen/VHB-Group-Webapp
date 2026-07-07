"""site domains environments rollback

Revision ID: 5a7c9e1f3b2d
Revises: 4f6a8c0d2e1b
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "5a7c9e1f3b2d"
down_revision: Union[str, Sequence[str], None] = "4f6a8c0d2e1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "site_deployments",
        sa.Column(
            "environment",
            sa.String(length=32),
            server_default="production",
            nullable=False,
        ),
    )
    op.add_column(
        "site_deployments",
        sa.Column("active", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_index(
        op.f("ix_site_deployments_environment"),
        "site_deployments",
        ["environment"],
    )
    op.create_index(op.f("ix_site_deployments_active"), "site_deployments", ["active"])

    op.create_table(
        "site_domains",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column(
            "environment",
            sa.String(length=32),
            server_default="production",
            nullable=False,
        ),
        sa.Column("verified", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hostname", name="uq_site_domain_hostname"),
    )
    op.create_index(op.f("ix_site_domains_environment"), "site_domains", ["environment"])
    op.create_index(op.f("ix_site_domains_primary"), "site_domains", ["primary"])
    op.create_index(op.f("ix_site_domains_site_id"), "site_domains", ["site_id"])
    op.create_index(op.f("ix_site_domains_verified"), "site_domains", ["verified"])
    op.create_index(op.f("ix_site_domains_workspace_id"), "site_domains", ["workspace_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_site_domains_workspace_id"), table_name="site_domains")
    op.drop_index(op.f("ix_site_domains_verified"), table_name="site_domains")
    op.drop_index(op.f("ix_site_domains_site_id"), table_name="site_domains")
    op.drop_index(op.f("ix_site_domains_primary"), table_name="site_domains")
    op.drop_index(op.f("ix_site_domains_environment"), table_name="site_domains")
    op.drop_table("site_domains")
    op.drop_index(op.f("ix_site_deployments_active"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_environment"), table_name="site_deployments")
    op.drop_column("site_deployments", "active")
    op.drop_column("site_deployments", "environment")
