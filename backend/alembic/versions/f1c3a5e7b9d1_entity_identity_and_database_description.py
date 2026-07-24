"""entity identity and database description

Revision ID: f1c3a5e7b9d1
Revises: e8f0a2c4e6f8
Create Date: 2026-07-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f1c3a5e7b9d1"
down_revision: Union[str, Sequence[str], None] = "e8f0a2c4e6f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("databases", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("entities", sa.Column("uid", sa.String(length=64), nullable=True))
    op.add_column("entities", sa.Column("name", sa.String(length=200), nullable=True))

    # A legacy entity already has a per-database sequence.  It becomes the
    # immutable UID, while Name is recovered from the first existing `Name`
    # text field.  Empty and duplicate values are made safe deterministically.
    op.get_bind().exec_driver_sql(
        """
            WITH name_fields AS (
                SELECT DISTINCT ON (database_id) id, database_id
                FROM fields
                WHERE lower(name) = 'name' AND type = 'text'
                ORDER BY database_id, "order", id
            ), candidates AS (
                SELECT e.id, e.database_id,
                       LEFT(COALESCE(NULLIF(BTRIM(e.data ->> nf.id::text), ''), 'Untitled'), 190) AS base_name
                FROM entities e
                LEFT JOIN name_fields nf ON nf.database_id = e.database_id
            ), ranked AS (
                SELECT id, database_id, base_name,
                       ROW_NUMBER() OVER (
                         PARTITION BY database_id, lower(base_name) ORDER BY id
                       ) AS duplicate_number
                FROM candidates
            )
            UPDATE entities e
            SET uid = 'UID-' || LPAD(e.seq::text, 6, '0'),
                name = CASE WHEN r.duplicate_number = 1 THEN r.base_name
                            ELSE LEFT(r.base_name, 190) || ' ' || r.duplicate_number::text END
            FROM ranked r
            WHERE r.id = e.id
            """
    )
    op.alter_column("entities", "uid", nullable=False)
    op.alter_column("entities", "name", nullable=False)
    op.create_unique_constraint("uq_entity_database_uid", "entities", ["database_id", "uid"])
    op.create_unique_constraint("uq_entity_database_name", "entities", ["database_id", "name"])
    op.create_index(
        "uq_entity_database_name_ci",
        "entities",
        ["database_id", sa.text("lower(name)")],
        unique=True,
    )

    # Mark the canonical built-in fields so renames/additional text fields do
    # not detach identity from the table's UID and Name columns.
    op.get_bind().exec_driver_sql(
        """
            WITH uid_fields AS (
                SELECT DISTINCT ON (database_id) id
                FROM fields
                WHERE type = 'unique_id'
                ORDER BY database_id, "order", id
            ), name_fields AS (
                SELECT DISTINCT ON (database_id) id
                FROM fields
                WHERE lower(name) = 'name' AND type = 'text'
                ORDER BY database_id, "order", id
            )
            UPDATE fields f
            SET options = COALESCE(f.options, '{}'::jsonb) ||
                CASE
                  WHEN f.id IN (SELECT id FROM uid_fields)
                    THEN '{"system_key":"uid","required":true}'::jsonb
                  WHEN f.id IN (SELECT id FROM name_fields)
                    THEN '{"system_key":"name","required":true}'::jsonb
                  ELSE '{}'::jsonb
                END
            WHERE f.id IN (SELECT id FROM uid_fields UNION SELECT id FROM name_fields)
            """
    )


def downgrade() -> None:
    op.drop_index("uq_entity_database_name_ci", table_name="entities")
    op.drop_constraint("uq_entity_database_name", "entities", type_="unique")
    op.drop_constraint("uq_entity_database_uid", "entities", type_="unique")
    op.drop_column("entities", "name")
    op.drop_column("entities", "uid")
    op.drop_column("databases", "description")
