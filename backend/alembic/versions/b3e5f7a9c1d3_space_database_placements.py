"""space database placements and space-owned dashboards

Revision ID: b3e5f7a9c1d3
Revises: a2d4f6b8c0e2
Create Date: 2026-07-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "b3e5f7a9c1d3"
down_revision: Union[str, Sequence[str], None] = "a2d4f6b8c0e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "space_database_placements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("folder_id", sa.Uuid(), nullable=True),
        sa.Column("layout_id", sa.Uuid(), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(["folder_id"], ["folders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["layout_id"], ["layouts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("space_id", "database_id", name="uq_space_database_placement"),
    )
    op.create_index(
        op.f("ix_space_database_placements_database_id"),
        "space_database_placements",
        ["database_id"],
    )
    op.create_index(
        op.f("ix_space_database_placements_folder_id"),
        "space_database_placements",
        ["folder_id"],
    )
    op.create_index(
        op.f("ix_space_database_placements_layout_id"),
        "space_database_placements",
        ["layout_id"],
    )
    op.create_index(
        op.f("ix_space_database_placements_space_id"),
        "space_database_placements",
        ["space_id"],
    )
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO space_database_placements (
            id, space_id, database_id, folder_id, layout_id, "order", settings,
            created_at, updated_at
        )
        SELECT gen_random_uuid(), f.space_id, d.id, d.folder_id, NULL, d."order",
               '{}'::jsonb, now(), now()
        FROM databases d
        JOIN folders f ON f.id = d.folder_id
        """
    )
    op.alter_column("space_database_placements", "settings", server_default=None)
    op.drop_index(op.f("ix_databases_folder_id"), table_name="databases")
    op.drop_constraint("fk_databases_folder_id", "databases", type_="foreignkey")
    op.drop_column("databases", "folder_id")

    op.add_column("dashboards", sa.Column("space_id", sa.Uuid(), nullable=True))
    op.add_column(
        "dashboards",
        sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_foreign_key(
        "fk_dashboards_space_id",
        "dashboards",
        "spaces",
        ["space_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO spaces (id, workspace_id, name, icon, color, "order", created_at, updated_at)
        SELECT gen_random_uuid(), w.id, 'General', NULL, NULL, 0, now(), now()
        FROM workspaces w
        WHERE NOT EXISTS (SELECT 1 FROM spaces s WHERE s.workspace_id = w.id)
        """
    )
    op.get_bind().exec_driver_sql(
        """
        WITH first_space AS (
            SELECT DISTINCT ON (workspace_id) id, workspace_id
            FROM spaces
            ORDER BY workspace_id, "order", created_at, id
        )
        UPDATE dashboards d
        SET space_id = first_space.id
        FROM first_space
        WHERE d.workspace_id = first_space.workspace_id
          AND d.space_id IS NULL
        """
    )
    op.get_bind().exec_driver_sql(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY space_id ORDER BY updated_at DESC, id) AS rank
            FROM dashboards
        )
        UPDATE dashboards d
        SET is_default = true
        FROM ranked
        WHERE d.id = ranked.id AND ranked.rank = 1
        """
    )
    op.get_bind().exec_driver_sql(
        """
        INSERT INTO dashboards (
            id, workspace_id, space_id, created_by_id, updated_by_id,
            name, description, is_default, created_at, updated_at
        )
        SELECT gen_random_uuid(), s.workspace_id, s.id, member.user_id, member.user_id,
               'Overview', NULL, true, now(), now()
        FROM spaces s
        CROSS JOIN LATERAL (
            SELECT wm.user_id
            FROM workspace_members wm
            WHERE wm.workspace_id = s.workspace_id
            ORDER BY wm.created_at, wm.user_id
            LIMIT 1
        ) AS member
        WHERE NOT EXISTS (
            SELECT 1 FROM dashboards d WHERE d.space_id = s.id
        )
        """
    )
    op.alter_column("dashboards", "space_id", nullable=False)
    op.alter_column("dashboards", "is_default", server_default=None)
    op.create_index(op.f("ix_dashboards_space_id"), "dashboards", ["space_id"])
    op.create_index(
        "uq_dashboards_default_per_space",
        "dashboards",
        ["space_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def downgrade() -> None:
    op.drop_index("uq_dashboards_default_per_space", table_name="dashboards")
    op.drop_index(op.f("ix_dashboards_space_id"), table_name="dashboards")
    op.drop_constraint("fk_dashboards_space_id", "dashboards", type_="foreignkey")
    op.drop_column("dashboards", "is_default")
    op.drop_column("dashboards", "space_id")

    op.add_column("databases", sa.Column("folder_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_databases_folder_id",
        "databases",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_databases_folder_id"), "databases", ["folder_id"])
    op.get_bind().exec_driver_sql(
        """
        WITH first_placement AS (
            SELECT DISTINCT ON (database_id) database_id, folder_id
            FROM space_database_placements
            WHERE folder_id IS NOT NULL
            ORDER BY database_id, created_at, id
        )
        UPDATE databases d
        SET folder_id = first_placement.folder_id
        FROM first_placement
        WHERE d.id = first_placement.database_id
        """
    )
    op.drop_index(
        op.f("ix_space_database_placements_space_id"),
        table_name="space_database_placements",
    )
    op.drop_index(
        op.f("ix_space_database_placements_layout_id"),
        table_name="space_database_placements",
    )
    op.drop_index(
        op.f("ix_space_database_placements_folder_id"),
        table_name="space_database_placements",
    )
    op.drop_index(
        op.f("ix_space_database_placements_database_id"),
        table_name="space_database_placements",
    )
    op.drop_table("space_database_placements")
