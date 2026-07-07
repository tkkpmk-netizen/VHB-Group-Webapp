"""site deployments

Revision ID: 4f6a8c0d2e1b
Revises: 3c5e7f9b0d1a
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "4f6a8c0d2e1b"
down_revision: Union[str, Sequence[str], None] = "3c5e7f9b0d1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "site_deployments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("job_id", sa.Uuid(), nullable=True),
        sa.Column("asset_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("entry_path", sa.String(length=255), nullable=False),
        sa.Column("manifest", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_site_deployments_asset_id"), "site_deployments", ["asset_id"])
    op.create_index(
        op.f("ix_site_deployments_created_by_id"),
        "site_deployments",
        ["created_by_id"],
    )
    op.create_index(op.f("ix_site_deployments_job_id"), "site_deployments", ["job_id"])
    op.create_index(op.f("ix_site_deployments_site_id"), "site_deployments", ["site_id"])
    op.create_index(op.f("ix_site_deployments_status"), "site_deployments", ["status"])
    op.create_index(op.f("ix_site_deployments_version"), "site_deployments", ["version"])
    op.create_index(
        op.f("ix_site_deployments_workspace_id"),
        "site_deployments",
        ["workspace_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_site_deployments_workspace_id"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_version"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_status"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_site_id"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_job_id"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_created_by_id"), table_name="site_deployments")
    op.drop_index(op.f("ix_site_deployments_asset_id"), table_name="site_deployments")
    op.drop_table("site_deployments")
