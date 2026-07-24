"""placement-specific layouts

Revision ID: d5a7c9e1f3b5
Revises: c4f6a8b0d2e4
Create Date: 2026-07-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5a7c9e1f3b5"
down_revision: Union[str, Sequence[str], None] = "c4f6a8b0d2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("layouts", sa.Column("placement_id", sa.Uuid(), nullable=True))
    op.add_column("layouts", sa.Column("source_layout_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_layouts_placement_id",
        "layouts",
        "space_database_placements",
        ["placement_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "fk_layouts_source_layout_id",
        "layouts",
        "layouts",
        ["source_layout_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_layouts_placement_id"), "layouts", ["placement_id"])
    op.create_index(op.f("ix_layouts_source_layout_id"), "layouts", ["source_layout_id"])
    op.create_unique_constraint(
        "uq_layout_placement_source",
        "layouts",
        ["placement_id", "source_layout_id"],
    )

    connection = op.get_bind()
    connection.exec_driver_sql(
        """
        INSERT INTO layouts (
            id, database_id, placement_id, source_layout_id, name, icon, type,
            config, "order", active_view_preset_id, created_at, updated_at
        )
        SELECT gen_random_uuid(), source.database_id, placement.id, source.id,
               source.name, source.icon, source.type, source.config, source."order",
               NULL, now(), now()
        FROM space_database_placements placement
        JOIN layouts source
          ON source.database_id = placement.database_id
         AND source.placement_id IS NULL
        """
    )
    connection.exec_driver_sql(
        """
        WITH ranked AS (
            SELECT placement.id AS placement_id,
                   clone.id AS layout_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY placement.id
                       ORDER BY (clone.source_layout_id = placement.layout_id) DESC,
                                clone."order", clone.created_at, clone.id
                   ) AS rank
            FROM space_database_placements placement
            JOIN layouts clone ON clone.placement_id = placement.id
        )
        UPDATE space_database_placements placement
        SET layout_id = ranked.layout_id
        FROM ranked
        WHERE ranked.placement_id = placement.id AND ranked.rank = 1
        """
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        UPDATE space_database_placements placement
        SET layout_id = clone.source_layout_id
        FROM layouts clone
        WHERE clone.id = placement.layout_id
          AND clone.placement_id = placement.id
        """
    )
    op.drop_constraint("uq_layout_placement_source", "layouts", type_="unique")
    op.drop_index(op.f("ix_layouts_source_layout_id"), table_name="layouts")
    op.drop_index(op.f("ix_layouts_placement_id"), table_name="layouts")
    op.drop_constraint("fk_layouts_source_layout_id", "layouts", type_="foreignkey")
    op.drop_constraint("fk_layouts_placement_id", "layouts", type_="foreignkey")
    op.drop_column("layouts", "source_layout_id")
    op.drop_column("layouts", "placement_id")
