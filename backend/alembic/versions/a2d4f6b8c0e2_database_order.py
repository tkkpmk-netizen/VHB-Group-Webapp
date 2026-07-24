"""persist database order inside resource folders

Revision ID: a2d4f6b8c0e2
Revises: f1c3a5e7b9d1
Create Date: 2026-07-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a2d4f6b8c0e2"
down_revision: Union[str, Sequence[str], None] = "f1c3a5e7b9d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "databases",
        sa.Column("order", sa.Integer(), server_default="0", nullable=False),
    )
    op.get_bind().exec_driver_sql(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY workspace_id, folder_id
                       ORDER BY created_at, id
                   ) - 1 AS position
            FROM databases
        )
        UPDATE databases
        SET "order" = ranked.position
        FROM ranked
        WHERE databases.id = ranked.id
        """
    )
    op.alter_column("databases", "order", server_default=None)


def downgrade() -> None:
    op.drop_column("databases", "order")
