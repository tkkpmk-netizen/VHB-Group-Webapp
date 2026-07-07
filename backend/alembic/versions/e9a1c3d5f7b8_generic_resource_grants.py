"""generic resource grants

Revision ID: e9a1c3d5f7b8
Revises: d8f0b2c4e6a7
Create Date: 2026-07-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e9a1c3d5f7b8"
down_revision: Union[str, Sequence[str], None] = "d8f0b2c4e6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "resource_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("resource_type", sa.String(length=32), nullable=False),
        sa.Column("resource_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
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
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "workspace_id",
            "resource_type",
            "resource_id",
            "user_id",
            name="uq_resource_grant_user",
        ),
    )
    op.create_index(
        op.f("ix_resource_grants_workspace_id"),
        "resource_grants",
        ["workspace_id"],
    )
    op.create_index(
        op.f("ix_resource_grants_resource_type"),
        "resource_grants",
        ["resource_type"],
    )
    op.create_index(
        op.f("ix_resource_grants_resource_id"),
        "resource_grants",
        ["resource_id"],
    )
    op.create_index(
        op.f("ix_resource_grants_user_id"),
        "resource_grants",
        ["user_id"],
    )
    op.execute(
        """
        INSERT INTO resource_grants (
            id, workspace_id, resource_type, resource_id, user_id, role,
            created_at, updated_at
        )
        SELECT
            grant_row.id, database_row.workspace_id, 'database',
            grant_row.database_id, grant_row.user_id, grant_row.role,
            grant_row.created_at, grant_row.updated_at
        FROM database_grants AS grant_row
        JOIN databases AS database_row ON database_row.id = grant_row.database_id
        """
    )
    op.drop_table("database_grants")


def downgrade() -> None:
    op.create_table(
        "database_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("database_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "database_id",
            "user_id",
            name="uq_database_grant_user",
        ),
    )
    op.create_index(
        op.f("ix_database_grants_database_id"),
        "database_grants",
        ["database_id"],
    )
    op.create_index(
        op.f("ix_database_grants_user_id"),
        "database_grants",
        ["user_id"],
    )
    op.execute(
        """
        INSERT INTO database_grants (
            id, database_id, user_id, role, created_at, updated_at
        )
        SELECT
            id, resource_id, user_id, role, created_at, updated_at
        FROM resource_grants
        WHERE resource_type = 'database'
        """
    )
    op.drop_table("resource_grants")
