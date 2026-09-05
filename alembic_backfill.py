"""Data backfill for migration 0002. Lives outside alembic/versions/ so it can be
imported and tested directly without going through Alembic's script runner.

Every statement is typed via `.columns(...)` / `.bindparams(...)` rather than
passing raw strings, so SQLAlchemy applies the dialect-correct processors: UUIDs
render as CHAR(32) hex on SQLite and native UUID on PostgreSQL, and JSON columns
serialize appropriately on each. Untyped raw SQL would round-trip one of the two
backends incorrectly.
"""

import json
import uuid

import sqlalchemy as sa

from backend.bible_markdown import BIBLE_TEMPLATE, render_bible_markdown

_PROJECTS = (
    sa.text("SELECT id, bible_content, outline_content FROM projects")
    .columns(id=sa.Uuid, bible_content=sa.Text, outline_content=sa.Text)
)

_CHAPTERS = (
    sa.text(
        "SELECT c.number AS number, c.draft AS draft, c.plan AS plan, "
        "c.issues AS issues, s.text AS summary "
        "FROM chapters c LEFT JOIN summaries s ON s.chapter_id = c.id "
        "WHERE c.project_id = :pid ORDER BY c.number"
    )
    .bindparams(sa.bindparam("pid", type_=sa.Uuid))
    .columns(number=sa.Integer, draft=sa.Text, plan=sa.JSON, issues=sa.JSON, summary=sa.Text)
)

_INSERT = sa.text(
    "INSERT INTO documents "
    "(id, project_id, title, kind, body, brief, plan, issues, summary, summary_hash, position) "
    "VALUES (:id, :project_id, :title, :kind, :body, :brief, :plan, :issues, :summary, NULL, :position)"
).bindparams(
    sa.bindparam("id", type_=sa.Uuid),
    sa.bindparam("project_id", type_=sa.Uuid),
    sa.bindparam("plan", type_=sa.JSON),
    sa.bindparam("issues", type_=sa.JSON),
)


def _loads(value, default):
    """Parse a JSON text column, tolerating NULL, empty string, and garbage."""
    if isinstance(value, (dict, list)):
        return value or default
    try:
        return json.loads(value) or default
    except (json.JSONDecodeError, TypeError, ValueError):
        return default


def backfill_documents(connection) -> None:
    """Populate `documents` from projects.bible_content / outline_content and the
    chapters + summaries tables. Reads only; the legacy tables are left intact."""
    for project in connection.execute(_PROJECTS).all():
        rows: list[dict] = []

        bible = _loads(project.bible_content, None)
        rows.append(
            {
                "title": "Story Bible",
                "kind": "bible",
                "body": render_bible_markdown(bible) if bible else BIBLE_TEMPLATE,
                "brief": "",
                "plan": None,
                "issues": None,
                "summary": None,
                "position": 0,
            }
        )

        beats = _loads(project.outline_content, {}).get("chapters") or []
        chapters = connection.execute(_CHAPTERS, {"pid": project.id}).all()
        by_number = {c.number: c for c in chapters}

        # Union of chapter rows and outline beats: an outlined-but-unwritten
        # chapter still deserves a document in the sidebar.
        highest = max([*by_number.keys(), len(beats)], default=0)
        for number in range(1, highest + 1):
            chapter = by_number.get(number)
            rows.append(
                {
                    "title": f"Chapter {number}",
                    "kind": "chapter",
                    "body": (chapter.draft if chapter and chapter.draft else ""),
                    "brief": beats[number - 1] if number <= len(beats) else "",
                    "plan": chapter.plan if chapter else None,
                    "issues": chapter.issues if chapter else None,
                    # summary_hash stays NULL so the first generation re-summarizes
                    # against the real body.
                    "summary": chapter.summary if chapter else None,
                    "position": number,
                }
            )

        for row in rows:
            connection.execute(
                _INSERT, {"id": uuid.uuid4(), "project_id": project.id, **row}
            )
