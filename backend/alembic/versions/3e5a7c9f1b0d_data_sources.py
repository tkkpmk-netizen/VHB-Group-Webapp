"""data sources

Revision ID: 3e5a7c9f1b0d
Revises: 2d4f6a8c0e1b
Create Date: 2026-07-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "3e5a7c9f1b0d"
down_revision: Union[str, Sequence[str], None] = "2d4f6a8c0e1b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("origin_asset_id", sa.Uuid(), nullable=True),
        sa.Column("origin_job_id", sa.Uuid(), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["origin_asset_id"], ["assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["origin_job_id"], ["jobs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_data_sources_database_id", "data_sources", ["database_id"])
    op.create_index("ix_data_sources_origin_asset_id", "data_sources", ["origin_asset_id"])
    op.create_index("ix_data_sources_origin_job_id", "data_sources", ["origin_job_id"])
    op.create_index(
        "uq_data_source_primary_per_database",
        "data_sources",
        ["database_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )

    # One "Primary" data source per existing database.
    op.execute(
        sa.text(
            """
            INSERT INTO data_sources (id, database_id, name, kind, is_primary, "order",
                                       created_at, updated_at)
            SELECT gen_random_uuid(), d.id, 'Primary', 'manual', true, 0, now(), now()
            FROM databases d
            """
        )
    )

    # entities.data_source_id: add nullable, backfill to each database's
    # primary source, then lock down NOT NULL + the FK/index.
    op.add_column("entities", sa.Column("data_source_id", sa.Uuid(), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE entities e
            SET data_source_id = ds.id
            FROM data_sources ds
            WHERE ds.database_id = e.database_id AND ds.is_primary
            """
        )
    )
    op.alter_column("entities", "data_source_id", nullable=False)
    op.create_foreign_key(
        "fk_entities_data_source_id",
        "entities",
        "data_sources",
        ["data_source_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_entities_data_source_id", "entities", ["data_source_id"])


def downgrade() -> None:
    op.drop_index("ix_entities_data_source_id", table_name="entities")
    op.drop_constraint("fk_entities_data_source_id", "entities", type_="foreignkey")
    op.drop_column("entities", "data_source_id")
    op.drop_table("data_sources")
