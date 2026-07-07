"""sites and public runtime

Revision ID: 3c5e7f9b0d1a
Revises: 2b4d6f8a0c1e
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "3c5e7f9b0d1a"
down_revision: Union[str, Sequence[str], None] = "2b4d6f8a0c1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("updated_by_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("homepage_path", sa.String(length=255), nullable=False),
        sa.Column("published", sa.Boolean(), nullable=False),
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
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="uq_site_slug"),
    )
    op.create_index(op.f("ix_sites_folder_id"), "sites", ["folder_id"])
    op.create_index(op.f("ix_sites_workspace_id"), "sites", ["workspace_id"])
    op.create_table(
        "site_pages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("path", sa.String(length=255), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "path", name="uq_site_page_path"),
    )
    op.create_index(op.f("ix_site_pages_site_id"), "site_pages", ["site_id"])
    op.create_table(
        "site_data_bindings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("page_id", sa.Uuid(), nullable=True),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("query", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("field_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("expose_public", sa.Boolean(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["page_id"], ["site_pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "key", name="uq_site_binding_key"),
    )
    op.create_index(
        op.f("ix_site_data_bindings_database_id"),
        "site_data_bindings",
        ["database_id"],
    )
    op.create_index(
        op.f("ix_site_data_bindings_page_id"),
        "site_data_bindings",
        ["page_id"],
    )
    op.create_index(
        op.f("ix_site_data_bindings_site_id"),
        "site_data_bindings",
        ["site_id"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_site_data_bindings_site_id"), table_name="site_data_bindings")
    op.drop_index(op.f("ix_site_data_bindings_page_id"), table_name="site_data_bindings")
    op.drop_index(
        op.f("ix_site_data_bindings_database_id"),
        table_name="site_data_bindings",
    )
    op.drop_table("site_data_bindings")
    op.drop_index(op.f("ix_site_pages_site_id"), table_name="site_pages")
    op.drop_table("site_pages")
    op.drop_index(op.f("ix_sites_workspace_id"), table_name="sites")
    op.drop_index(op.f("ix_sites_folder_id"), table_name="sites")
    op.drop_table("sites")
