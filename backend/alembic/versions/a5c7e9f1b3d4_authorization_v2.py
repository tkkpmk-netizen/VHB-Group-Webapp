"""authorization v2

Revision ID: a5c7e9f1b3d4
Revises: 9a4b2c6d8e1f
Create Date: 2026-07-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a5c7e9f1b3d4"
down_revision: Union[str, Sequence[str], None] = "9a4b2c6d8e1f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'admin'")
    op.execute("ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'editor'")
    op.execute("ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'viewer'")
    op.create_table(
        "database_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("database_id", "user_id", name="uq_database_grant_user"),
    )
    op.create_index(op.f("ix_database_grants_database_id"), "database_grants", ["database_id"])
    op.create_index(op.f("ix_database_grants_user_id"), "database_grants", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_database_grants_user_id"), table_name="database_grants")
    op.drop_index(op.f("ix_database_grants_database_id"), table_name="database_grants")
    op.drop_table("database_grants")
