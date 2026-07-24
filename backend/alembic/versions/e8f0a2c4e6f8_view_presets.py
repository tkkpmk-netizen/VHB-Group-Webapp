"""view presets

Revision ID: e8f0a2c4e6f8
Revises: 3e5a7c9f1b0d
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e8f0a2c4e6f8"
down_revision: Union[str, Sequence[str], None] = "3e5a7c9f1b0d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "view_presets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("layout_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("filter", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("sorts", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("group_field_id", sa.String(length=64), nullable=True),
        sa.Column("hide_empty", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["layout_id"], ["layouts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_view_presets_layout_id", "view_presets", ["layout_id"])

    op.add_column("layouts", sa.Column("active_view_preset_id", sa.Uuid(), nullable=True))

    # Backfill existing config.presets / config.activePreset (frontend-owned
    # JSONB, see Layout.config) into real rows, then strip those keys out of
    # config now that ViewPreset is the source of truth.
    op.execute(
        sa.text(
            """
            INSERT INTO view_presets (id, layout_id, name, filter, sorts, group_field_id,
                                       hide_empty, "order", created_at, updated_at)
            SELECT
                (preset->>'id')::uuid,
                l.id,
                COALESCE(preset->>'name', 'Untitled'),
                COALESCE(preset->'filter', '{"conj":"and","rules":[]}'::jsonb),
                COALESCE(preset->'sorts', '[]'::jsonb),
                NULLIF(preset->>'group', ''),
                COALESCE((preset->>'hideEmpty')::boolean, false),
                (ordinality - 1),
                now(), now()
            FROM layouts l
            CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.config->'presets', '[]'::jsonb))
                WITH ORDINALITY AS t(preset, ordinality)
            WHERE preset->>'id' ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE layouts l
            SET active_view_preset_id = (l.config->>'activePreset')::uuid
            WHERE l.config ? 'activePreset'
              AND l.config->>'activePreset' ~*
                  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND EXISTS (
                  SELECT 1 FROM view_presets vp WHERE vp.id = (l.config->>'activePreset')::uuid
              )
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE layouts
            SET config = (config - 'presets') - 'activePreset'
            WHERE config ? 'presets' OR config ? 'activePreset'
            """
        )
    )

    op.create_foreign_key(
        "fk_layouts_active_view_preset_id",
        "layouts",
        "view_presets",
        ["active_view_preset_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_layouts_active_view_preset_id", "layouts", ["active_view_preset_id"])


def downgrade() -> None:
    op.drop_index("ix_layouts_active_view_preset_id", table_name="layouts")
    op.drop_constraint("fk_layouts_active_view_preset_id", "layouts", type_="foreignkey")
    op.drop_column("layouts", "active_view_preset_id")
    op.drop_index("ix_view_presets_layout_id", table_name="view_presets")
    op.drop_table("view_presets")
