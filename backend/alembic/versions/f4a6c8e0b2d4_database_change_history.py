"""database change history

Revision ID: f4a6c8e0b2d4
Revises: f2d4e6a8c0b1
Create Date: 2026-07-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4a6c8e0b2d4"
down_revision: Union[str, Sequence[str], None] = "f2d4e6a8c0b1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "database_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "before",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("reverted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reverted_by_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reverted_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_database_changes_action", "database_changes", ["action"])
    op.create_index("ix_database_changes_actor_id", "database_changes", ["actor_id"])
    op.create_index("ix_database_changes_created_at", "database_changes", ["created_at"])
    op.create_index("ix_database_changes_database_id", "database_changes", ["database_id"])
    op.create_index("ix_database_changes_reverted_at", "database_changes", ["reverted_at"])
    op.create_index("ix_database_changes_workspace_id", "database_changes", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_database_changes_workspace_id", table_name="database_changes")
    op.drop_index("ix_database_changes_reverted_at", table_name="database_changes")
    op.drop_index("ix_database_changes_database_id", table_name="database_changes")
    op.drop_index("ix_database_changes_created_at", table_name="database_changes")
    op.drop_index("ix_database_changes_actor_id", table_name="database_changes")
    op.drop_index("ix_database_changes_action", table_name="database_changes")
    op.drop_table("database_changes")
