"""seed a General space for existing workspaces

Revision ID: 9a4b2c6d8e1f
Revises: 8f3a1d2c4b5e
Create Date: 2026-07-02
"""

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "9a4b2c6d8e1f"
down_revision: Union[str, Sequence[str], None] = "8f3a1d2c4b5e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    workspace_ids = connection.execute(
        sa.text(
            """
            SELECT w.id
            FROM workspaces AS w
            WHERE NOT EXISTS (
                SELECT 1 FROM spaces AS s WHERE s.workspace_id = w.id
            )
            """
        )
    ).scalars()
    for workspace_id in workspace_ids:
        connection.execute(
            sa.text(
                """
                INSERT INTO spaces
                    (id, workspace_id, name, icon, color, "order")
                VALUES
                    (:id, :workspace_id, 'General', NULL, NULL, 0)
                """
            ),
            {"id": uuid.uuid4(), "workspace_id": workspace_id},
        )


def downgrade() -> None:
    # Seeded spaces may contain user resources after deployment. Deleting them
    # during downgrade would be destructive, so this data migration is one-way.
    pass
