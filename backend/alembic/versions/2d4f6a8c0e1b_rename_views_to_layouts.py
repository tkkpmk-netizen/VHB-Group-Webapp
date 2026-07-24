"""rename views to layouts

Revision ID: 2d4f6a8c0e1b
Revises: 8f1a3c5e7b2d
Create Date: 2026-07-08
"""

from typing import Sequence, Union

from alembic import op

revision: str = "2d4f6a8c0e1b"
down_revision: Union[str, Sequence[str], None] = "8f1a3c5e7b2d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Metadata-only rename (no table rewrite); LayoutType stays native_enum=False
    # (VARCHAR), so there is no Postgres enum type to rename alongside it.
    op.rename_table("views", "layouts")
    op.execute("ALTER INDEX ix_views_database_id RENAME TO ix_layouts_database_id")


def downgrade() -> None:
    op.execute("ALTER INDEX ix_layouts_database_id RENAME TO ix_views_database_id")
    op.rename_table("layouts", "views")
