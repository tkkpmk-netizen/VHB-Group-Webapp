"""persist FA5 icons and link documents to source entities

Revision ID: c4f6a8b0d2e4
Revises: b3e5f7a9c1d3
Create Date: 2026-07-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4f6a8b0d2e4"
down_revision: Union[str, Sequence[str], None] = "b3e5f7a9c1d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("spaces", "icon", existing_type=sa.String(32), type_=sa.String(64))
    op.alter_column("databases", "icon", existing_type=sa.String(16), type_=sa.String(64))
    op.alter_column("documents", "icon", existing_type=sa.String(32), type_=sa.String(64))
    op.add_column("folders", sa.Column("icon", sa.String(64), nullable=True))
    op.add_column("layouts", sa.Column("icon", sa.String(64), nullable=True))
    op.add_column("fields", sa.Column("icon", sa.String(64), nullable=True))
    op.add_column("documents", sa.Column("source_entity_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_documents_source_entity_id",
        "documents",
        "entities",
        ["source_entity_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_documents_source_entity_id"),
        "documents",
        ["source_entity_id"],
    )

    connection = op.get_bind()
    connection.exec_driver_sql("UPDATE spaces SET icon = 'layer-group' WHERE icon IS NULL")
    connection.exec_driver_sql("UPDATE folders SET icon = 'folder.1' WHERE icon IS NULL")
    connection.exec_driver_sql("UPDATE databases SET icon = 'database' WHERE icon IS NULL")
    connection.exec_driver_sql("UPDATE documents SET icon = 'file-alt' WHERE icon IS NULL")
    connection.exec_driver_sql(
        """
        UPDATE layouts
        SET icon = CASE type
            WHEN 'table' THEN 'table'
            WHEN 'board' THEN 'columns'
            WHEN 'list' THEN 'th-list'
            WHEN 'calendar' THEN 'calendar-alt.1'
            WHEN 'gallery' THEN 'images.1'
            WHEN 'gantt' THEN 'stream'
            ELSE 'table'
        END
        WHERE icon IS NULL
        """
    )
    connection.exec_driver_sql(
        """
        UPDATE fields
        SET icon = CASE type
            WHEN 'unique_id' THEN 'fingerprint'
            WHEN 'text' THEN 'font'
            WHEN 'long_text' THEN 'align-left'
            WHEN 'number' THEN 'hashtag'
            WHEN 'checkbox' THEN 'check-square.1'
            WHEN 'date' THEN 'calendar-day'
            WHEN 'url' THEN 'link'
            WHEN 'email' THEN 'envelope'
            WHEN 'phone' THEN 'phone'
            WHEN 'select' THEN 'tag'
            WHEN 'multi_select' THEN 'tags'
            WHEN 'status' THEN 'tasks'
            WHEN 'priority' THEN 'flag'
            WHEN 'rating' THEN 'star.1'
            WHEN 'relation' THEN 'project-diagram'
            WHEN 'rollup' THEN 'layer-group'
            WHEN 'formula' THEN 'calculator'
            WHEN 'people' THEN 'user-friends'
            WHEN 'files' THEN 'paperclip'
            WHEN 'progress' THEN 'tasks'
            ELSE 'circle'
        END
        WHERE icon IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_documents_source_entity_id"), table_name="documents")
    op.drop_constraint("fk_documents_source_entity_id", "documents", type_="foreignkey")
    op.drop_column("documents", "source_entity_id")
    op.drop_column("fields", "icon")
    op.drop_column("layouts", "icon")
    op.drop_column("folders", "icon")
    op.alter_column("documents", "icon", existing_type=sa.String(64), type_=sa.String(32))
    op.alter_column("databases", "icon", existing_type=sa.String(64), type_=sa.String(16))
    op.alter_column("spaces", "icon", existing_type=sa.String(64), type_=sa.String(32))
