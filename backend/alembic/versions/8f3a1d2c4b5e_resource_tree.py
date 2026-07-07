"""workspace resource tree

Revision ID: 8f3a1d2c4b5e
Revises: 5be947580858
Create Date: 2026-07-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "8f3a1d2c4b5e"
down_revision: Union[str, Sequence[str], None] = "5be947580858"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "spaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("icon", sa.String(length=32), nullable=True),
        sa.Column("color", sa.String(length=32), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_spaces_workspace_id"), "spaces", ["workspace_id"])

    op.create_table(
        "folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["parent_id"], ["folders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_folders_parent_id"), "folders", ["parent_id"])
    op.create_index(op.f("ix_folders_space_id"), "folders", ["space_id"])

    op.add_column("databases", sa.Column("folder_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_databases_folder_id",
        "databases",
        "folders",
        ["folder_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_databases_folder_id"), "databases", ["folder_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_databases_folder_id"), table_name="databases")
    op.drop_constraint("fk_databases_folder_id", "databases", type_="foreignkey")
    op.drop_column("databases", "folder_id")
    op.drop_index(op.f("ix_folders_space_id"), table_name="folders")
    op.drop_index(op.f("ix_folders_parent_id"), table_name="folders")
    op.drop_table("folders")
    op.drop_index(op.f("ix_spaces_workspace_id"), table_name="spaces")
    op.drop_table("spaces")
