"""per-chapter chat messages

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-13

Adds the conversation each chapter's chat pane keeps, including the proposals
the assistant attaches and whether the writer accepted them.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("proposal", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("document_id", "position", name="uq_chat_messages_document_position"),
    )
    op.create_index("ix_chat_messages_document_id", "chat_messages", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_document_id", table_name="chat_messages")
    op.drop_table("chat_messages")
