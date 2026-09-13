"""per-user model choice and AI spend metering

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-06

Adds the model each writer generates with, an optional per-user budget
override, and the append-only usage_events ledger the monthly meter sums.
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default as well as the ORM default, so existing rows are backfilled
    # by the ALTER itself rather than left NULL against a NOT NULL column.
    op.add_column(
        "users",
        sa.Column("model_key", sa.String(16), nullable=False, server_default="haiku"),
    )
    op.add_column(
        "users",
        sa.Column("monthly_budget_micro_usd", sa.BigInteger(), nullable=True),
    )

    op.create_table(
        "usage_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("model_key", sa.String(16), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_read_input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cache_creation_input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_micro_usd", sa.BigInteger(), nullable=False, server_default="0"),
    )
    # The only query over this table is "this user, since the 1st of the month".
    op.create_index("ix_usage_events_user_created", "usage_events", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_usage_events_user_created", table_name="usage_events")
    op.drop_table("usage_events")
    op.drop_column("users", "monthly_budget_micro_usd")
    op.drop_column("users", "model_key")
