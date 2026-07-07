"""google drive files

Revision ID: 2b4d6f8a0c1e
Revises: 1a3c5e7f9b0d
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2b4d6f8a0c1e"
down_revision: Union[str, Sequence[str], None] = "1a3c5e7f9b0d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "drive_files",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("row_id", sa.Uuid(), nullable=False),
        sa.Column("field_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("google_file_id", sa.String(length=255), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
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
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["database_id"], ["databases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["fields.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["row_id"], ["rows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("google_file_id", name="uq_drive_file_google_id"),
    )
    op.create_index(
        op.f("ix_drive_files_created_by_id"),
        "drive_files",
        ["created_by_id"],
    )
    op.create_index(op.f("ix_drive_files_database_id"), "drive_files", ["database_id"])
    op.create_index(op.f("ix_drive_files_field_id"), "drive_files", ["field_id"])
    op.create_index(op.f("ix_drive_files_row_id"), "drive_files", ["row_id"])
    op.create_index(op.f("ix_drive_files_workspace_id"), "drive_files", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("drive_files")
