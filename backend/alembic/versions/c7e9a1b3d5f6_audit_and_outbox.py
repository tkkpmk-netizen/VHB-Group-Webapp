"""audit and transactional outbox

Revision ID: c7e9a1b3d5f6
Revises: b6d8f0a2c4e5
Create Date: 2026-07-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c7e9a1b3d5f6"
down_revision: Union[str, Sequence[str], None] = "b6d8f0a2c4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=150), nullable=False),
        sa.Column("resource_type", sa.String(length=100), nullable=False),
        sa.Column("resource_id", sa.String(length=200), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_events_action"), "audit_events", ["action"])
    op.create_index(op.f("ix_audit_events_actor_id"), "audit_events", ["actor_id"])
    op.create_index(op.f("ix_audit_events_created_at"), "audit_events", ["created_at"])
    op.create_index(op.f("ix_audit_events_workspace_id"), "audit_events", ["workspace_id"])

    op.create_table(
        "outbox_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("topic", sa.String(length=150), nullable=False),
        sa.Column("aggregate_type", sa.String(length=100), nullable=False),
        sa.Column("aggregate_id", sa.String(length=200), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_outbox_events_published_at"), "outbox_events", ["published_at"])
    op.create_index(op.f("ix_outbox_events_topic"), "outbox_events", ["topic"])
    op.create_index(op.f("ix_outbox_events_workspace_id"), "outbox_events", ["workspace_id"])

    op.execute(
        """
        CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit_events are immutable';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_immutable
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS reject_audit_event_mutation")
    op.drop_index(op.f("ix_outbox_events_workspace_id"), table_name="outbox_events")
    op.drop_index(op.f("ix_outbox_events_topic"), table_name="outbox_events")
    op.drop_index(op.f("ix_outbox_events_published_at"), table_name="outbox_events")
    op.drop_table("outbox_events")
    op.drop_index(op.f("ix_audit_events_workspace_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_created_at"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_actor_id"), table_name="audit_events")
    op.drop_index(op.f("ix_audit_events_action"), table_name="audit_events")
    op.drop_table("audit_events")
