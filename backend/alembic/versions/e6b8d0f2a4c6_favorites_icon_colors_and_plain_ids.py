"""favorites, icon colors and plain sequential entity ids

Revision ID: e6b8d0f2a4c6
Revises: d5a7c9e1f3b5
Create Date: 2026-07-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6b8d0f2a4c6"
down_revision: Union[str, Sequence[str], None] = "d5a7c9e1f3b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("databases", "folders", "fields", "layouts", "documents"):
        op.add_column(table, sa.Column("icon_color", sa.String(32), nullable=True))

    op.create_table(
        "database_favorites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "database_id", name="uq_database_favorite_user_database"
        ),
    )
    op.create_index(op.f("ix_database_favorites_workspace_id"), "database_favorites", ["workspace_id"])
    op.create_index(op.f("ix_database_favorites_user_id"), "database_favorites", ["user_id"])
    op.create_index(op.f("ix_database_favorites_database_id"), "database_favorites", ["database_id"])

    # Existing canonical UIDs become their immutable per-database sequence.
    # Mirror the same value into the built-in ID cell so old and new rows agree.
    op.get_bind().exec_driver_sql(
        """
        UPDATE entities entity
        SET uid = entity.seq::text,
            data = jsonb_set(
                COALESCE(entity.data, '{}'::jsonb),
                ARRAY[field.id::text],
                to_jsonb(entity.seq::text),
                true
            )
        FROM fields field
        WHERE field.database_id = entity.database_id
          AND field.type = 'unique_id'
          AND field.options->>'system_key' = 'uid'
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_database_favorites_database_id"), table_name="database_favorites")
    op.drop_index(op.f("ix_database_favorites_user_id"), table_name="database_favorites")
    op.drop_index(op.f("ix_database_favorites_workspace_id"), table_name="database_favorites")
    op.drop_table("database_favorites")
    for table in reversed(("databases", "folders", "fields", "layouts", "documents")):
        op.drop_column(table, "icon_color")
    op.get_bind().exec_driver_sql(
        """
        UPDATE entities entity
        SET uid = 'UID-' || LPAD(entity.seq::text, 6, '0'),
            data = jsonb_set(
                COALESCE(entity.data, '{}'::jsonb),
                ARRAY[field.id::text],
                to_jsonb('UID-' || LPAD(entity.seq::text, 6, '0')),
                true
            )
        FROM fields field
        WHERE field.database_id = entity.database_id
          AND field.type = 'unique_id'
          AND field.options->>'system_key' = 'uid'
        """
    )
