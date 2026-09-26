"""authentication moves to Clerk

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-25

Clerk now owns identity: email, password and sessions. A user row is keyed by
its Clerk user id and created on that user's first authenticated request, so
email and hashed_password go away.

Existing accounts cannot be carried over, because they have no Clerk identity
to attach to, so every user is deleted along with everything they own. The
deletes run child-first because SQLite does not enforce ON DELETE CASCADE
unless foreign keys are switched on for the connection.
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# Children before parents.
_OWNED_BY_USERS = (
    "chat_messages",
    "draft_states",
    "summaries",
    "documents",
    "chapters",
    "projects",
    "usage_events",
    "users",
)


def upgrade() -> None:
    for table in _OWNED_BY_USERS:
        op.execute(sa.text(f"DELETE FROM {table}"))

    op.drop_index("ix_users_email", table_name="users")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email")
        batch.drop_column("hashed_password")
        batch.add_column(sa.Column("clerk_user_id", sa.String(64), nullable=False))
        batch.create_index("ix_users_clerk_user_id", ["clerk_user_id"], unique=True)


def downgrade() -> None:
    for table in _OWNED_BY_USERS:
        op.execute(sa.text(f"DELETE FROM {table}"))

    with op.batch_alter_table("users") as batch:
        batch.drop_index("ix_users_clerk_user_id")
        batch.drop_column("clerk_user_id")
        batch.add_column(sa.Column("email", sa.String(255), nullable=False))
        batch.add_column(sa.Column("hashed_password", sa.Text(), nullable=False))
        batch.create_unique_constraint("uq_users_email", ["email"])
    op.create_index("ix_users_email", "users", ["email"])
