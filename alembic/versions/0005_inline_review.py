"""inline review: specialist agents in the chat, no Issues panel

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-20

Records which specialist agent a chat turn was addressed to, and drops
documents.issues. Issues are no longer a stored list shown in a panel: a review
pass now returns localized fixes that live on the chat message's proposal until
the writer accepts or discards each one.

Dropping the column loses whatever the old Check button last wrote. That list
was only ever a snapshot of one model call, re-runnable at any time.
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("agent", sa.String(32), nullable=True))
    # batch mode so the DROP also works on the SQLite file used in local dev.
    with op.batch_alter_table("documents") as batch:
        batch.drop_column("issues")


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("issues", sa.JSON(), nullable=True))
    op.drop_column("chat_messages", "agent")
