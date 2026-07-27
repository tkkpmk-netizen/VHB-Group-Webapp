"""name field type and database-scoped unique field names

Revision ID: f2d4e6a8c0b1
Revises: e6b8d0f2a4c6
Create Date: 2026-07-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2d4e6a8c0b1"
down_revision: Union[str, Sequence[str], None] = "e6b8d0f2a4c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Preserve every existing field while making duplicate labels explicit.
    op.get_bind().exec_driver_sql(
        """
        WITH ranked AS (
            SELECT id,
                   name,
                   ROW_NUMBER() OVER (
                       PARTITION BY database_id, LOWER(BTRIM(name))
                       ORDER BY "order", created_at, id
                   ) AS duplicate_number
            FROM fields
        )
        UPDATE fields AS field
        SET name = LEFT(ranked.name, 181) || ' [' || LEFT(field.id::text, 8) || ']'
        FROM ranked
        WHERE field.id = ranked.id
          AND ranked.duplicate_number > 1
        """
    )
    op.get_bind().exec_driver_sql(
        """
        UPDATE fields
        SET type = 'name'
        WHERE options->>'system_key' = 'name'
        """
    )
    op.create_unique_constraint(
        "uq_field_database_name", "fields", ["database_id", "name"]
    )
    op.create_index(
        "uq_field_database_name_ci",
        "fields",
        ["database_id", sa.text("lower(btrim(name))")],
        unique=True,
    )
    op.create_index(
        "uq_field_single_name_type",
        "fields",
        ["database_id"],
        unique=True,
        postgresql_where=sa.text("type = 'name'"),
    )


def downgrade() -> None:
    op.drop_index("uq_field_single_name_type", table_name="fields")
    op.drop_index("uq_field_database_name_ci", table_name="fields")
    op.drop_constraint("uq_field_database_name", "fields", type_="unique")
    op.get_bind().exec_driver_sql(
        """
        UPDATE fields
        SET type = 'text'
        WHERE options->>'system_key' = 'name'
        """
    )
