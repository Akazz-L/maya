"""billing: Stripe customers and subscriptions

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-25

A writer's plan comes from their Stripe subscription. users gains the Stripe
customer a checkout is opened for, and subscriptions mirrors each Stripe
subscription as Stripe last reported it.
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("stripe_customer_id", sa.String(64), nullable=True))
        batch.create_unique_constraint("uq_users_stripe_customer_id", ["stripe_customer_id"])

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("stripe_subscription_id", sa.String(64), nullable=False, unique=True),
        sa.Column("stripe_price_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cancel_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_subscriptions_user_id", "subscriptions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_subscriptions_user_id", table_name="subscriptions")
    op.drop_table("subscriptions")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("uq_users_stripe_customer_id", type_="unique")
        batch.drop_column("stripe_customer_id")
