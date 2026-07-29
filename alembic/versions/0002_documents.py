"""documents table + backfill from bible/outline/chapters

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-29

Deliberately non-destructive: `make dev` runs `alembic upgrade head` on every
start, so dropping the legacy tables here would run automatically and
irreversibly against the deployed database. Dropping them is a later migration,
applied once the new UI is confirmed working.
"""

import uuid

import sqlalchemy as sa
from alembic import op

from alembic_backfill import backfill_documents

UUID = sa.Uuid
JSONB = sa.JSON

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(255), nullable=False, server_default="Untitled"),
        sa.Column("kind", sa.String(16), nullable=False, server_default="chapter"),
        sa.Column("body", sa.Text, nullable=False, server_default=""),
        sa.Column("brief", sa.Text, nullable=False, server_default=""),
        sa.Column("plan", JSONB, nullable=True),
        sa.Column("issues", JSONB, nullable=True),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("summary_hash", sa.String(64), nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_documents_project_id", "documents", ["project_id"])
    op.create_index(
        "uq_documents_project_bible",
        "documents",
        ["project_id"],
        unique=True,
        sqlite_where=sa.text("kind = 'bible'"),
        postgresql_where=sa.text("kind = 'bible'"),
    )

    backfill_documents(op.get_bind())


def downgrade() -> None:
    op.drop_index("uq_documents_project_bible", table_name="documents")
    op.drop_index("ix_documents_project_id", table_name="documents")
    op.drop_table("documents")
