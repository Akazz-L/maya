import json
import uuid

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_backfill_converts_bible_chapters_and_outline(db):
    """Seed the 0001 shape, run the 0002 backfill, assert the documents."""
    from alembic_backfill import backfill_documents

    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, created_at) "
            "VALUES (:i, :e, :p, CURRENT_TIMESTAMP)"
        ),
        {"i": user_id.hex, "e": "a@b.c", "p": "x"},
    )
    await db.execute(
        text(
            "INSERT INTO projects (id, user_id, name, bible_content, outline_content, created_at, updated_at) "
            "VALUES (:i, :u, :n, :b, :o, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {
            "i": project_id.hex,
            "u": user_id.hex,
            "n": "Novel",
            "b": json.dumps({"characters": [{"name": "Elena", "traits": ["bold"]}]}),
            "o": json.dumps({"chapters": ["Elena arrives", "Elena leaves", "Elena returns"]}),
        },
    )
    await db.execute(
        text(
            "INSERT INTO chapters (id, project_id, number, draft, status, created_at, updated_at) "
            "VALUES (:i, :p, 1, :d, 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"i": uuid.uuid4().hex, "p": project_id.hex, "d": "The gates stood open."},
    )
    await db.commit()

    conn = await db.connection()
    await conn.run_sync(backfill_documents)
    await db.commit()

    rows = (
        await db.execute(
            text("SELECT title, kind, body, brief, position FROM documents ORDER BY position")
        )
    ).all()

    assert rows[0].kind == "bible"
    assert rows[0].position == 0
    assert "### Elena" in rows[0].body

    chapters = [r for r in rows if r.kind == "chapter"]
    assert [c.title for c in chapters] == ["Chapter 1", "Chapter 2", "Chapter 3"]
    assert chapters[0].body == "The gates stood open."
    assert chapters[0].brief == "Elena arrives"
    # Outline beats with no chapter row still become empty documents.
    assert chapters[1].body == ""
    assert chapters[1].brief == "Elena leaves"


@pytest.mark.asyncio
async def test_backfill_carries_over_summaries(db):
    from alembic_backfill import backfill_documents

    project_id, user_id, chapter_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, created_at) "
            "VALUES (:i, 'x@y.z', 'p', CURRENT_TIMESTAMP)"
        ),
        {"i": user_id.hex},
    )
    await db.execute(
        text(
            "INSERT INTO projects (id, user_id, name, bible_content, outline_content, created_at, updated_at) "
            "VALUES (:i, :u, 'P', '', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"i": project_id.hex, "u": user_id.hex},
    )
    await db.execute(
        text(
            "INSERT INTO chapters (id, project_id, number, draft, status, created_at, updated_at) "
            "VALUES (:i, :p, 1, 'Prose.', 'accepted', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"i": chapter_id.hex, "p": project_id.hex},
    )
    await db.execute(
        text("INSERT INTO summaries (id, chapter_id, text) VALUES (:i, :c, 'Elena arrived.')"),
        {"i": uuid.uuid4().hex, "c": chapter_id.hex},
    )
    await db.commit()

    conn = await db.connection()
    await conn.run_sync(backfill_documents)
    await db.commit()

    row = (
        await db.execute(
            text("SELECT summary, summary_hash FROM documents WHERE kind='chapter'")
        )
    ).one()
    assert row.summary == "Elena arrived."
    # NULL hash forces a re-summarize against the real body on first generation.
    assert row.summary_hash is None


@pytest.mark.asyncio
async def test_backfill_seeds_template_for_unparseable_bible(db):
    from alembic_backfill import backfill_documents
    from backend.bible_markdown import BIBLE_TEMPLATE

    project_id, user_id = uuid.uuid4(), uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO users (id, email, hashed_password, created_at) "
            "VALUES (:i, :e, :p, CURRENT_TIMESTAMP)"
        ),
        {"i": user_id.hex, "e": "c@d.e", "p": "x"},
    )
    await db.execute(
        text(
            "INSERT INTO projects (id, user_id, name, bible_content, outline_content, created_at, updated_at) "
            "VALUES (:i, :u, 'P', 'not json', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"i": project_id.hex, "u": user_id.hex},
    )
    await db.commit()

    conn = await db.connection()
    await conn.run_sync(backfill_documents)
    await db.commit()

    body = (await db.execute(text("SELECT body FROM documents WHERE kind='bible'"))).scalar_one()
    assert body == BIBLE_TEMPLATE


@pytest.mark.asyncio
async def test_one_bible_per_project_enforced(db):
    from sqlalchemy.exc import IntegrityError

    from backend.db_models import Document, Project, User

    user = User(email="e@f.g", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.flush()

    db.add(Document(project_id=project.id, title="Story Bible", kind="bible", position=0))
    await db.commit()

    db.add(Document(project_id=project.id, title="Second Bible", kind="bible", position=1))
    with pytest.raises(IntegrityError):
        await db.commit()
