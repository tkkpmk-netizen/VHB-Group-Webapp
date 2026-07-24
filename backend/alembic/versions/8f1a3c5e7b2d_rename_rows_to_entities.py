"""rename rows to entities

Revision ID: 8f1a3c5e7b2d
Revises: 6b8d0f2a4c3e
Create Date: 2026-07-08
"""

from typing import Sequence, Union

from alembic import op

revision: str = "8f1a3c5e7b2d"
down_revision: Union[str, Sequence[str], None] = "6b8d0f2a4c3e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # All renames below are metadata-only (no table rewrite).
    op.rename_table("rows", "entities")
    op.execute("ALTER INDEX ix_rows_database_id RENAME TO ix_entities_database_id")
    op.execute(
        "ALTER TABLE entities RENAME CONSTRAINT uq_row_database_seq TO uq_entity_database_seq"
    )

    op.rename_table("row_links", "entity_links")
    op.alter_column("entity_links", "source_row_id", new_column_name="source_entity_id")
    op.alter_column("entity_links", "target_row_id", new_column_name="target_entity_id")
    op.execute("ALTER TABLE entity_links RENAME CONSTRAINT uq_row_link TO uq_entity_link")
    op.execute("ALTER INDEX ix_row_links_field_id RENAME TO ix_entity_links_field_id")
    op.execute(
        "ALTER INDEX ix_row_links_source_row_id RENAME TO ix_entity_links_source_entity_id"
    )
    op.execute(
        "ALTER INDEX ix_row_links_target_row_id RENAME TO ix_entity_links_target_entity_id"
    )

    op.alter_column("drive_files", "row_id", new_column_name="entity_id")
    op.execute("ALTER INDEX ix_drive_files_row_id RENAME TO ix_drive_files_entity_id")
    # ponytail: the original FK constraints (e.g. drive_files_row_id_fkey) were
    # never explicitly named, so Postgres auto-assigned names that still say
    # "row" internally. Cosmetic only — renaming them adds risk (guessing the
    # exact auto-generated name) for no behavioral benefit; skip unless it
    # actually gets in the way of a future autogenerate diff.


def downgrade() -> None:
    op.alter_column("drive_files", "entity_id", new_column_name="row_id")
    op.execute("ALTER INDEX ix_drive_files_entity_id RENAME TO ix_drive_files_row_id")

    op.execute(
        "ALTER INDEX ix_entity_links_target_entity_id RENAME TO ix_row_links_target_row_id"
    )
    op.execute(
        "ALTER INDEX ix_entity_links_source_entity_id RENAME TO ix_row_links_source_row_id"
    )
    op.execute("ALTER INDEX ix_entity_links_field_id RENAME TO ix_row_links_field_id")
    op.execute("ALTER TABLE entity_links RENAME CONSTRAINT uq_entity_link TO uq_row_link")
    op.alter_column("entity_links", "target_entity_id", new_column_name="target_row_id")
    op.alter_column("entity_links", "source_entity_id", new_column_name="source_row_id")
    op.rename_table("entity_links", "row_links")

    op.execute(
        "ALTER TABLE entities RENAME CONSTRAINT uq_entity_database_seq TO uq_row_database_seq"
    )
    op.execute("ALTER INDEX ix_entities_database_id RENAME TO ix_rows_database_id")
    op.rename_table("entities", "rows")
