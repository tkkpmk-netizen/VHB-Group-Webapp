"""bind commercial catalog mini apps to dynamic databases

Revision ID: e5a3c9d7f2b4
Revises: d4f2a8c6e1b3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e5a3c9d7f2b4"
down_revision: str | None = "d4f2a8c6e1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "commercial_catalog_bindings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("database_id", name="uq_commercial_catalog_database"),
        sa.UniqueConstraint("workspace_id", "kind", name="uq_commercial_catalog_kind"),
    )
    op.create_index(
        "ix_commercial_catalog_bindings_workspace_id",
        "commercial_catalog_bindings",
        ["workspace_id"],
    )
    op.create_index("ix_commercial_catalog_bindings_kind", "commercial_catalog_bindings", ["kind"])
    op.create_index(
        "ix_commercial_catalog_bindings_database_id",
        "commercial_catalog_bindings",
        ["database_id"],
        unique=True,
    )
    op.create_index(
        "ix_commercial_catalog_bindings_created_by_id",
        "commercial_catalog_bindings",
        ["created_by_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_commercial_catalog_bindings_created_by_id", table_name="commercial_catalog_bindings"
    )
    op.drop_index(
        "ix_commercial_catalog_bindings_database_id", table_name="commercial_catalog_bindings"
    )
    op.drop_index("ix_commercial_catalog_bindings_kind", table_name="commercial_catalog_bindings")
    op.drop_index(
        "ix_commercial_catalog_bindings_workspace_id", table_name="commercial_catalog_bindings"
    )
    op.drop_table("commercial_catalog_bindings")
