"""unique (database_id, seq) on rows

Revision ID: 6b8d0f2a4c3e
Revises: 5a7c9e1f3b2d
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "6b8d0f2a4c3e"
down_revision: Union[str, Sequence[str], None] = "5a7c9e1f3b2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Repair any duplicates created by the old racy max(seq)+1 allocation
    # before the constraint lands: re-number duplicate seqs past max(seq).
    op.execute(
        sa.text(
            """
            WITH dupes AS (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY database_id, seq ORDER BY created_at, id
                       ) AS rn,
                       MAX(seq) OVER (PARTITION BY database_id) AS max_seq
                FROM rows
            ),
            renumber AS (
                SELECT id,
                       ROW_NUMBER() OVER (ORDER BY id) AS offset_n
                FROM dupes
                WHERE rn > 1
            )
            UPDATE rows
            SET seq = d.max_seq + r.offset_n
            FROM renumber r
            JOIN dupes d ON d.id = r.id
            WHERE rows.id = r.id
            """
        )
    )
    op.create_unique_constraint("uq_row_database_seq", "rows", ["database_id", "seq"])


def downgrade() -> None:
    op.drop_constraint("uq_row_database_seq", "rows", type_="unique")
