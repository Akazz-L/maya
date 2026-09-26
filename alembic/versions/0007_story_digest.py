"""the story so far: a rolling digest of the chapters before each one

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-25

Everything older than the summary window is folded into one running digest,
held per chapter because it is a prefix: the digest read while revising chapter
6 must not carry what happens in chapter 30. Replaces the ten-chapter cap,
which forgot the opening of a long book outright.
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch mode so the ALTER also works on the SQLite file used in local dev.
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("digest", sa.Text(), nullable=True))
        batch.add_column(sa.Column("digest_hash", sa.String(64), nullable=True))
        batch.add_column(
            sa.Column("digest_edited", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_column("digest_edited")
        batch.drop_column("digest_hash")
        batch.drop_column("digest")
