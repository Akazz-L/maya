"""the writer can edit a chapter's summary

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-25

Marks a summary the writer wrote themselves. Such a summary is never replaced
by the automatic refresh, however far the chapter body drifts from it: the
Summary view says the chapter has changed and leaves regenerating to the writer.

Existing summaries were all generated, so false is the right backfill.
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch mode so the ALTER also works on the SQLite file used in local dev.
    with op.batch_alter_table("documents") as batch:
        batch.add_column(
            sa.Column(
                "summary_edited",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_column("summary_edited")
