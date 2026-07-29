# Document Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Maya's chapter wizard with a document-based workspace — a collapsible sidebar of free-text documents, one pinned Story Bible per project, and Generate Plan / Generate Draft / Check actions on chapter documents with the plan in a resizable bottom panel.

**Architecture:** A single new `documents` table supersedes `projects.bible_content`, `projects.outline_content`, and the `chapters` / `draft_states` / `summaries` tables. Each document carries its own `brief`, which replaces the `outline.chapters[n-1]` index lookup that currently prevents chapters from existing outside the outline. The three agents move from a structured bible dict to one markdown string. The frontend replaces `workflowReducer`'s `plan → draft → check → saved` state machine with TanStack Query over documents plus local panel state.

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Alembic, aiosqlite/asyncpg, pytest + pytest-asyncio, React 19, TypeScript, TanStack Query v5, react-router-dom v7, Tailwind v4, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-29-document-workspace-design.md`

## Global Constraints

- Alembic is the sole source of schema truth. `backend/db.py:init_db` deliberately does not call `create_all`; never add DDL outside `alembic/versions/`.
- Every migration must run on **both** SQLite and PostgreSQL. Use `sa.Uuid` and `sa.JSON` (aliased `UUID` / `JSONB` in `0001_initial.py`), and supply both `sqlite_where=` and `postgresql_where=` for partial indexes.
- Migration `0002` is **non-destructive**. `make dev` and `make backend` run `alembic upgrade head` on every start, so it must not drop `chapters`, `draft_states`, `summaries`, `projects.bible_content`, or `projects.outline_content`.
- `kind` is one of exactly `'bible'`, `'chapter'`, `'note'`.
- Prior-chapter context is capped at the **10** documents nearest the target, summarized concurrently via `asyncio.gather`.
- Autosave debounce is **800ms**, matching the cadence `StoryBiblePage` uses today.
- Backend tests run with `uv run pytest`; frontend with `npm test` from `frontend/`.
- Every task ends with a commit. Do not proceed to the next task with a failing suite.

---

### Task 1: Bible markdown renderer

The migration and the project bootstrap both need to turn a structured bible dict into markdown. Pure function, no DB, so it lands first.

**Files:**
- Create: `backend/bible_markdown.py`
- Test: `tests/test_bible_markdown.py`

**Interfaces:**
- Consumes: nothing
- Produces: `BIBLE_TEMPLATE: str`, `render_bible_markdown(data: dict) -> str`

- [ ] **Step 1: Write the failing test**

Create `tests/test_bible_markdown.py`:

```python
from backend.bible_markdown import BIBLE_TEMPLATE, render_bible_markdown


def test_empty_dict_returns_template():
    assert render_bible_markdown({}) == BIBLE_TEMPLATE


def test_template_has_the_four_headings():
    for heading in ("## Characters", "## World", "## Style", "## Timeline"):
        assert heading in BIBLE_TEMPLATE


def test_renders_characters_with_traits_and_dialogue(sample_bible):
    md = render_bible_markdown(sample_bible)
    assert "### Elena" in md
    assert "- determined" in md
    assert '- "I won\'t wait."' in md


def test_renders_world_style_and_timeline(sample_bible):
    md = render_bible_markdown(sample_bible)
    assert "- The Citadel" in md
    assert "- Magic requires physical cost" in md
    assert "sparse and precise" in md
    assert "- adverbs ending in -ly" in md
    assert "- Elena leaves home" in md


def test_headings_present_even_when_sections_empty():
    md = render_bible_markdown({"characters": [], "world": {}, "timeline": []})
    for heading in ("## Characters", "## World", "## Style", "## Timeline"):
        assert heading in md


def test_tolerates_none_valued_keys():
    md = render_bible_markdown(
        {"characters": None, "world": None, "style_guide": None, "timeline": None}
    )
    assert "## Characters" in md


def test_character_without_name_is_labelled_unnamed():
    md = render_bible_markdown({"characters": [{"traits": ["quiet"]}]})
    assert "### Unnamed" in md
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_bible_markdown.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.bible_markdown'`

- [ ] **Step 3: Write the implementation**

Create `backend/bible_markdown.py`:

```python
"""Render a legacy structured story bible into the markdown a bible document holds.

Used by migration 0002 to convert existing projects, and by project creation to
seed a new bible with the conventional headings.
"""

BIBLE_TEMPLATE = "## Characters\n\n## World\n\n## Style\n\n## Timeline\n"


def _bullets(items) -> list[str]:
    return [f"- {item}" for item in (items or [])]


def _characters(characters) -> list[str]:
    lines: list[str] = []
    for char in characters or []:
        lines.append(f"### {char.get('name') or 'Unnamed'}")
        traits = char.get("traits") or []
        if traits:
            lines += ["", "Traits:", *_bullets(traits)]
        examples = char.get("dialogue_examples") or []
        if examples:
            lines += ["", "Dialogue examples:", *[f'- "{e}"' for e in examples]]
        lines.append("")
    return lines


def _world(world) -> list[str]:
    lines: list[str] = []
    world = world or {}
    locations = world.get("locations") or []
    if locations:
        lines += ["", "Locations:", *_bullets(locations)]
    rules = world.get("rules") or []
    if rules:
        lines += ["", "Rules:", *_bullets(rules)]
    return lines


def _style(style) -> list[str]:
    lines: list[str] = []
    style = style or {}
    voice = (style.get("voice") or "").strip()
    if voice:
        lines += ["", f"Voice: {voice}"]
    avoid = style.get("avoid") or []
    if avoid:
        lines += ["", "Avoid:", *_bullets(avoid)]
    return lines


def render_bible_markdown(data: dict) -> str:
    """Convert a structured bible dict to markdown. Returns BIBLE_TEMPLATE when
    there is nothing to render, so a new or empty project still gets headings."""
    if not data:
        return BIBLE_TEMPLATE

    sections = [
        ("## Characters", _characters(data.get("characters"))),
        ("## World", _world(data.get("world"))),
        ("## Style", _style(data.get("style_guide"))),
        ("## Timeline", _bullets(data.get("timeline")) and ["", *_bullets(data.get("timeline"))] or []),
    ]

    lines: list[str] = []
    for heading, body in sections:
        lines.append(heading)
        lines += body
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_bible_markdown.py -v`
Expected: PASS — 7 passed

- [ ] **Step 5: Commit**

```bash
git add backend/bible_markdown.py tests/test_bible_markdown.py
git commit -m "feat: render structured story bibles as markdown"
```

---

### Task 2: Document model and migration 0002

**Files:**
- Modify: `backend/db_models.py` (append after `Chapter`)
- Create: `alembic/versions/0002_documents.py`
- Test: `tests/test_migration_documents.py`

**Interfaces:**
- Consumes: `render_bible_markdown`, `BIBLE_TEMPLATE` from Task 1
- Produces: `Document` model with fields `id, project_id, title, kind, body, brief, plan, issues, summary, summary_hash, position, created_at, updated_at`; alembic revision `"0002"`

- [ ] **Step 1: Write the failing test**

Create `tests/test_migration_documents.py`. This drives the migration's backfill logic through a seeded pre-migration database:

```python
import json
import uuid

import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_backfill_converts_bible_chapters_and_outline(db):
    """Seed the 0001 shape, run the 0002 backfill, assert the documents."""
    from alembic_backfill import backfill_documents  # re-exported for testability

    project_id = uuid.uuid4()
    user_id = uuid.uuid4()
    await db.execute(
        text("INSERT INTO users (id, email, hashed_password) VALUES (:i, :e, :p)"),
        {"i": user_id.hex, "e": "a@b.c", "p": "x"},
    )
    await db.execute(
        text(
            "INSERT INTO projects (id, user_id, name, bible_content, outline_content) "
            "VALUES (:i, :u, :n, :b, :o)"
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
        text("INSERT INTO chapters (id, project_id, number, draft, status) VALUES (:i, :p, 1, :d, 'accepted')"),
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
async def test_backfill_seeds_template_for_unparseable_bible(db):
    from alembic_backfill import backfill_documents
    from backend.bible_markdown import BIBLE_TEMPLATE

    project_id, user_id = uuid.uuid4(), uuid.uuid4()
    await db.execute(
        text("INSERT INTO users (id, email, hashed_password) VALUES (:i, :e, :p)"),
        {"i": user_id.hex, "e": "c@d.e", "p": "x"},
    )
    await db.execute(
        text(
            "INSERT INTO projects (id, user_id, name, bible_content, outline_content) "
            "VALUES (:i, :u, 'P', 'not json', '')"
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
    from backend.db_models import Document, Project, User
    from sqlalchemy.exc import IntegrityError

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
```

Note the test imports `alembic_backfill` — a top-level module the migration also
imports, so the backfill is testable without invoking Alembic's runner.

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_migration_documents.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'alembic_backfill'`

- [ ] **Step 3: Add the `Document` model**

Append to `backend/db_models.py` (after the `Chapter` class), and add `Index` and `text` to the existing imports:

```python
from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text, UniqueConstraint, Uuid, text
```

```python
class Document(Base):
    __tablename__ = "documents"
    # One bible per project. Partial indexes work on both SQLite and PostgreSQL,
    # so the same declaration covers local dev and the Railway deployment.
    __table_args__ = (
        Index(
            "uq_documents_project_bible",
            "project_id",
            unique=True,
            sqlite_where=text("kind = 'bible'"),
            postgresql_where=text("kind = 'bible'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="Untitled")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="chapter")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    brief: Mapped[str] = mapped_column(Text, nullable=False, default="")
    plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    issues: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    position: Mapped[int] = mapped_column(nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    project: Mapped["Project"] = relationship("Project", back_populates="documents")
```

Add the reverse relationship to `Project` (after the `chapters` line):

```python
    documents: Mapped[list["Document"]] = relationship("Document", back_populates="project", cascade="all, delete-orphan")
```

- [ ] **Step 4: Write the backfill module**

Create `alembic_backfill.py` at the repo root (importable by both the migration and the test):

```python
"""Data backfill for migration 0002. Lives outside alembic/versions/ so it can be
imported and tested directly without going through Alembic's script runner."""

import json
import uuid

import sqlalchemy as sa

from backend.bible_markdown import BIBLE_TEMPLATE, render_bible_markdown


def _loads(value: str | None, default):
    try:
        return json.loads(value) or default
    except (json.JSONDecodeError, TypeError, ValueError):
        return default


def backfill_documents(connection) -> None:
    """Populate `documents` from projects.bible_content / outline_content and the
    chapters + summaries tables. Reads only; the legacy tables are left intact."""
    projects = connection.execute(
        sa.text("SELECT id, bible_content, outline_content FROM projects")
    ).all()

    for project in projects:
        rows: list[dict] = []

        bible = _loads(project.bible_content, None)
        rows.append(
            {
                "project_id": project.id,
                "title": "Story Bible",
                "kind": "bible",
                "body": render_bible_markdown(bible) if bible else BIBLE_TEMPLATE,
                "brief": "",
                "summary": None,
                "position": 0,
            }
        )

        beats = _loads(project.outline_content, {}).get("chapters") or []
        chapters = connection.execute(
            sa.text(
                "SELECT c.number, c.draft, c.plan, c.issues, s.text AS summary "
                "FROM chapters c LEFT JOIN summaries s ON s.chapter_id = c.id "
                "WHERE c.project_id = :pid ORDER BY c.number"
            ),
            {"pid": project.id},
        ).all()
        by_number = {c.number: c for c in chapters}

        # Union of chapter rows and outline beats: an outlined-but-unwritten
        # chapter still deserves a document in the sidebar.
        highest = max([*by_number.keys(), len(beats)], default=0)
        for number in range(1, highest + 1):
            chapter = by_number.get(number)
            rows.append(
                {
                    "project_id": project.id,
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
                sa.text(
                    "INSERT INTO documents "
                    "(id, project_id, title, kind, body, brief, plan, issues, summary, summary_hash, position) "
                    "VALUES (:id, :project_id, :title, :kind, :body, :brief, :plan, :issues, :summary, NULL, :position)"
                ),
                {
                    "id": uuid.uuid4().hex,
                    "plan": None,
                    "issues": None,
                    **row,
                    "plan": json.dumps(row.get("plan")) if row.get("plan") else None,
                    "issues": json.dumps(row.get("issues")) if row.get("issues") else None,
                },
            )
```

- [ ] **Step 5: Write the migration**

Create `alembic/versions/0002_documents.py`:

```python
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_migration_documents.py tests/test_bible_markdown.py -v`
Expected: PASS — 10 passed

- [ ] **Step 7: Verify the migration runs against the real database**

```bash
cp maya.db maya.db.bak
uv run alembic upgrade head
uv run python -c "
import sqlite3; c = sqlite3.connect('maya.db')
print(c.execute('SELECT kind, title, position FROM documents ORDER BY project_id, position').fetchall())
print('chapters still present:', c.execute('SELECT COUNT(*) FROM chapters').fetchone())
"
```

Expected: one `bible` row per project plus the chapter rows; the legacy `chapters`
count is unchanged. If anything looks wrong, `mv maya.db.bak maya.db` and fix.

- [ ] **Step 8: Commit**

```bash
git add backend/db_models.py alembic_backfill.py alembic/versions/0002_documents.py tests/test_migration_documents.py
git commit -m "feat: add documents table with backfill from bible, outline, and chapters"
```

---

### Task 3: Document storage layer

**Files:**
- Create: `backend/doc_storage.py`
- Test: `tests/test_doc_storage.py`

**Interfaces:**
- Consumes: `Document` from Task 2
- Produces:
  - `body_hash(body: str) -> str`
  - `async list_documents(db, project_id) -> list[Document]`
  - `async get_document(db, project_id, document_id) -> Document` (raises 404)
  - `async create_document(db, project_id, title=None, kind="chapter") -> Document`
  - `async update_document(db, doc, **fields) -> Document`
  - `async delete_document(db, project_id, document_id) -> None` (raises 409 on bible)
  - `async reorder_documents(db, project_id, document_ids: list[uuid.UUID]) -> None`
  - `async get_bible_body(db, project_id) -> str`
  - `VALID_KINDS: set[str]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_doc_storage.py`:

```python
import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="doc@test.com", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.commit()
    return project


@pytest.mark.asyncio
async def test_create_appends_at_end(db, project):
    from backend.doc_storage import create_document, list_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    assert (a.position, b.position) == (0, 1)
    assert [d.title for d in await list_documents(db, project.id)] == ["A", "B"]


@pytest.mark.asyncio
async def test_create_rejects_unknown_kind(db, project):
    from backend.doc_storage import create_document

    with pytest.raises(HTTPException) as exc:
        await create_document(db, project.id, kind="poem")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_get_document_missing_raises_404(db, project):
    from backend.doc_storage import get_document

    with pytest.raises(HTTPException) as exc:
        await get_document(db, project.id, uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_bible_raises_409(db, project):
    from backend.doc_storage import create_document, delete_document

    bible = await create_document(db, project.id, title="Story Bible", kind="bible")
    with pytest.raises(HTTPException) as exc:
        await delete_document(db, project.id, bible.id)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_delete_closes_position_gap(db, project):
    from backend.doc_storage import create_document, delete_document, list_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    c = await create_document(db, project.id, title="C")
    await delete_document(db, project.id, b.id)
    remaining = await list_documents(db, project.id)
    assert [(d.title, d.position) for d in remaining] == [("A", 0), ("C", 1)]
    assert {d.id for d in remaining} == {a.id, c.id}


@pytest.mark.asyncio
async def test_reorder_renumbers(db, project):
    from backend.doc_storage import create_document, list_documents, reorder_documents

    a = await create_document(db, project.id, title="A")
    b = await create_document(db, project.id, title="B")
    c = await create_document(db, project.id, title="C")
    await reorder_documents(db, project.id, [c.id, a.id, b.id])
    assert [d.title for d in await list_documents(db, project.id)] == ["C", "A", "B"]


@pytest.mark.asyncio
async def test_reorder_rejects_incomplete_list(db, project):
    from backend.doc_storage import create_document, reorder_documents

    a = await create_document(db, project.id, title="A")
    await create_document(db, project.id, title="B")
    with pytest.raises(HTTPException) as exc:
        await reorder_documents(db, project.id, [a.id])
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_body_hash_changes_with_body():
    from backend.doc_storage import body_hash

    assert body_hash("abc") == body_hash("abc")
    assert body_hash("abc") != body_hash("abd")
    assert len(body_hash("abc")) == 64


@pytest.mark.asyncio
async def test_get_bible_body_returns_empty_when_absent(db, project):
    from backend.doc_storage import get_bible_body

    assert await get_bible_body(db, project.id) == ""
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_doc_storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.doc_storage'`

- [ ] **Step 3: Write the implementation**

Create `backend/doc_storage.py`:

```python
import hashlib
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Document

VALID_KINDS = {"bible", "chapter", "note"}


def body_hash(body: str) -> str:
    """Cache key for a document's summary. Any edit to the body invalidates it."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


async def list_documents(db: AsyncSession, project_id: uuid.UUID) -> list[Document]:
    result = await db.execute(
        select(Document).where(Document.project_id == project_id).order_by(Document.position)
    )
    return list(result.scalars())


async def get_document(db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == document_id, Document.project_id == project_id)
    )
    document = result.scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


async def create_document(
    db: AsyncSession,
    project_id: uuid.UUID,
    title: str | None = None,
    kind: str = "chapter",
    body: str = "",
) -> Document:
    if kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind: {kind}")
    existing = await list_documents(db, project_id)
    document = Document(
        project_id=project_id,
        title=title or "Untitled",
        kind=kind,
        body=body,
        position=len(existing),
    )
    db.add(document)
    await db.commit()
    await db.refresh(document)
    return document


async def update_document(db: AsyncSession, document: Document, **fields) -> Document:
    if "kind" in fields and fields["kind"] not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"Invalid kind: {fields['kind']}")
    for key, value in fields.items():
        if value is not None:
            setattr(document, key, value)
    # A body edit invalidates the cached summary.
    if fields.get("body") is not None:
        document.summary_hash = None
    await db.commit()
    await db.refresh(document)
    return document


async def delete_document(db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID) -> None:
    document = await get_document(db, project_id, document_id)
    if document.kind == "bible":
        raise HTTPException(status_code=409, detail="The story bible cannot be deleted")
    await db.delete(document)
    await db.flush()
    # Close the gap so positions stay contiguous.
    for index, remaining in enumerate(await list_documents(db, project_id)):
        remaining.position = index
    await db.commit()


async def reorder_documents(
    db: AsyncSession, project_id: uuid.UUID, document_ids: list[uuid.UUID]
) -> None:
    documents = await list_documents(db, project_id)
    if {d.id for d in documents} != set(document_ids) or len(documents) != len(document_ids):
        raise HTTPException(
            status_code=400, detail="Order must list exactly the project's documents"
        )
    by_id = {d.id: d for d in documents}
    for index, document_id in enumerate(document_ids):
        by_id[document_id].position = index
    await db.commit()


async def get_bible_body(db: AsyncSession, project_id: uuid.UUID) -> str:
    result = await db.execute(
        select(Document.body).where(Document.project_id == project_id, Document.kind == "bible")
    )
    return result.scalar_one_or_none() or ""
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_doc_storage.py -v`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/doc_storage.py tests/test_doc_storage.py
git commit -m "feat: add document storage layer with ordering and summary hashing"
```

---

### Task 4: Documents router and project bootstrap

**Files:**
- Create: `backend/routes/__init__.py`, `backend/routes/documents.py`
- Modify: `backend/main.py` (project create/get; router mount)
- Test: `tests/test_documents_api.py`
- Modify: `tests/conftest.py` (drop the legacy bible/outline payload from `authed_client`)

**Interfaces:**
- Consumes: Task 3's storage functions; `render_bible_markdown` / `BIBLE_TEMPLATE`
- Produces: `router` (APIRouter, prefix `/projects/{project_id}/documents`); helper `require_project(project_id, current_user, db)` exported from `backend/routes/deps.py`

- [ ] **Step 1: Extract the ownership dependency**

Create `backend/routes/__init__.py` (empty) and `backend/routes/deps.py`:

```python
import uuid

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import get_current_user
from backend.db import get_db
from backend.db_models import Project, User


async def require_project(
    project_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Project:
    """Resolve a project the caller owns, or 404. A project id belonging to
    another user is indistinguishable from one that does not exist."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project or project.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_documents_api.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_new_project_has_a_seeded_bible(authed_client):
    from backend.bible_markdown import BIBLE_TEMPLATE

    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}/documents")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 1
    assert docs[0]["kind"] == "bible"
    assert docs[0]["title"] == "Story Bible"

    detail = await client.get(f"/projects/{project_id}/documents/{docs[0]['id']}")
    assert detail.json()["body"] == BIBLE_TEMPLATE


@pytest.mark.asyncio
async def test_list_omits_bodies(authed_client):
    client, project_id = authed_client
    docs = (await client.get(f"/projects/{project_id}/documents")).json()
    assert "body" not in docs[0]
    assert set(docs[0]) == {"id", "title", "kind", "position", "updated_at"}


@pytest.mark.asyncio
async def test_create_defaults_to_chapter(authed_client):
    client, project_id = authed_client
    resp = await client.post(f"/projects/{project_id}/documents", json={})
    assert resp.status_code == 201
    assert resp.json()["kind"] == "chapter"
    assert resp.json()["title"] == "Untitled"
    assert resp.json()["position"] == 1


@pytest.mark.asyncio
async def test_patch_updates_title_body_and_brief(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={"title": "Ch 1"})).json()["id"]

    resp = await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"body": "The rain had not stopped.", "brief": "Mara waits."},
    )
    assert resp.status_code == 200
    assert resp.json()["body"] == "The rain had not stopped."
    assert resp.json()["brief"] == "Mara waits."


@pytest.mark.asyncio
async def test_delete_bible_returns_409(authed_client):
    client, project_id = authed_client
    docs = (await client.get(f"/projects/{project_id}/documents")).json()
    resp = await client.delete(f"/projects/{project_id}/documents/{docs[0]['id']}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_chapter_succeeds(authed_client):
    client, project_id = authed_client
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]
    assert (await client.delete(f"/projects/{project_id}/documents/{doc_id}")).status_code == 204
    assert len((await client.get(f"/projects/{project_id}/documents")).json()) == 1


@pytest.mark.asyncio
async def test_reorder(authed_client):
    client, project_id = authed_client
    a = (await client.post(f"/projects/{project_id}/documents", json={"title": "A"})).json()["id"]
    b = (await client.post(f"/projects/{project_id}/documents", json={"title": "B"})).json()["id"]
    bible = (await client.get(f"/projects/{project_id}/documents")).json()[0]["id"]

    resp = await client.put(
        f"/projects/{project_id}/documents/order", json={"document_ids": [bible, b, a]}
    )
    assert resp.status_code == 204
    assert [d["title"] for d in (await client.get(f"/projects/{project_id}/documents")).json()] == [
        "Story Bible", "B", "A",
    ]


@pytest.mark.asyncio
async def test_invalid_kind_rejected(authed_client):
    client, project_id = authed_client
    resp = await client.post(f"/projects/{project_id}/documents", json={"kind": "poem"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_documents_not_visible_across_projects(authed_client):
    client, project_id = authed_client
    other = (await client.post("/projects", json={"name": "Other"})).json()["project_id"]
    doc_id = (await client.post(f"/projects/{project_id}/documents", json={})).json()["id"]

    assert (await client.get(f"/projects/{other}/documents/{doc_id}")).status_code == 404
```

Also simplify the `authed_client` fixture in `tests/conftest.py` — `bible_content`
and `outline_content` are no longer accepted by `POST /projects`:

```python
        # Create project
        resp = await client.post("/projects", json={"name": "Test Novel"})
        project_id = resp.json()["project_id"]
```

and drop the now-unused `import json` if nothing else in the file uses it.

- [ ] **Step 3: Run the test to verify it fails**

Run: `uv run pytest tests/test_documents_api.py -v`
Expected: FAIL — 404s on `/documents`, since the router does not exist yet.

- [ ] **Step 4: Write the router**

Create `backend/routes/documents.py`:

```python
import uuid

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.db_models import Project
from backend.doc_storage import (
    create_document,
    delete_document,
    get_document,
    list_documents,
    reorder_documents,
    update_document,
)
from backend.routes.deps import require_project

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


class DocumentCreateRequest(BaseModel):
    title: str | None = None
    kind: str = "chapter"


class DocumentUpdateRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    brief: str | None = None
    plan: dict | None = None
    issues: list | None = None
    kind: str | None = None


class OrderRequest(BaseModel):
    document_ids: list[uuid.UUID]


def _summary(document) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "kind": document.kind,
        "position": document.position,
        "updated_at": document.updated_at,
    }


def _detail(document) -> dict:
    return {
        **_summary(document),
        "body": document.body,
        "brief": document.brief,
        "plan": document.plan,
        "issues": document.issues,
    }


@router.get("")
async def get_documents(
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    return [_summary(d) for d in await list_documents(db, project.id)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def post_document(
    body: DocumentCreateRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await create_document(db, project.id, title=body.title, kind=body.kind)
    return _detail(document)


# Registered before /{document_id} so "order" is not parsed as a document id.
@router.put("/order", status_code=status.HTTP_204_NO_CONTENT)
async def put_order(
    body: OrderRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    await reorder_documents(db, project.id, body.document_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{document_id}")
async def get_one(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    return _detail(await get_document(db, project.id, document_id))


@router.patch("/{document_id}")
async def patch_document(
    document_id: uuid.UUID,
    body: DocumentUpdateRequest,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await get_document(db, project.id, document_id)
    return _detail(await update_document(db, document, **body.model_dump(exclude_unset=True)))


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_document(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    await delete_document(db, project.id, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Update project creation and mount the router**

In `backend/main.py`, replace `ProjectCreateRequest` and `create_project`:

```python
class ProjectCreateRequest(BaseModel):
    name: str


@app.post("/projects", status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(user_id=current_user.id, name=body.name)
    db.add(project)
    await db.flush()
    # Every project opens on a story bible; seed it with the conventional headings.
    db.add(Document(
        project_id=project.id, title="Story Bible", kind="bible",
        body=BIBLE_TEMPLATE, position=0,
    ))
    await db.commit()
    return {"project_id": str(project.id), "name": project.name}
```

Drop `bible_content` / `outline_content` from `get_project`'s response:

```python
    return {"project_id": str(project.id), "name": project.name}
```

Add the imports and mount:

```python
from backend.bible_markdown import BIBLE_TEMPLATE
from backend.db_models import Document, Project, User
from backend.routes import documents as documents_routes

app.include_router(documents_routes.router)
```

The router must be included **before** the `/{full_path:path}` SPA catch-all, which
is registered last by design.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_documents_api.py -v`
Expected: PASS — 9 passed

- [ ] **Step 7: Commit**

```bash
git add backend/routes/ backend/main.py tests/test_documents_api.py tests/conftest.py
git commit -m "feat: add document CRUD routes and seed a story bible per project"
```

---

### Task 5: Agents consume a markdown bible; add the summarizer

**Files:**
- Modify: `backend/agents/planner.py`, `backend/agents/drafter.py`, `backend/agents/checker.py`
- Create: `backend/agents/summarizer.py`
- Test: rewrite `tests/test_planner.py`, `tests/test_drafter.py`, `tests/test_checker.py`; create `tests/test_summarizer.py`
- Modify: `tests/conftest.py` (`sample_bible` → markdown, `base_state`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `state["story_bible"]` is now `str`; `summarize_node(text: str) -> str`

- [ ] **Step 1: Change the shared fixtures**

In `tests/conftest.py`, replace `sample_bible` and `base_state`:

```python
@pytest.fixture
def sample_bible():
    """The story bible as a document body — markdown, not a structured dict."""
    return (
        "## Characters\n\n"
        "### Elena\n\n"
        "Traits:\n- determined\n- left-handed\n\n"
        'Dialogue examples:\n- "I won\'t wait."\n- "The Citadel takes."\n\n'
        "## World\n\n"
        "Locations:\n- The Citadel\n- The Wastes\n\n"
        "Rules:\n- Magic requires physical cost\n\n"
        "## Style\n\n"
        "Voice: sparse and precise\n\n"
        "Avoid:\n- adverbs ending in -ly\n- passive voice\n\n"
        "## Timeline\n\n- Elena leaves home\n"
    )


@pytest.fixture
def base_state(sample_bible):
    return {
        "outline_beat": "Elena arrives at the Citadel gates and confronts the Gatekeeper",
        "story_bible": sample_bible,
        "previous_summaries": [],
        "scene_plan": {},
        "draft": "",
        "continuity_issues": [],
    }
```

`chapter_number` leaves the state dict — nothing keys off it any more.

- [ ] **Step 2: Write the failing tests**

Create `tests/test_summarizer.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest


class _Block:
    def __init__(self, text):
        self.text = text
        self.type = "text"


class _Response:
    def __init__(self, text):
        self.content = [_Block(text)]
        self.stop_reason = "end_turn"


@pytest.mark.asyncio
async def test_summarize_returns_text():
    from backend.agents import summarizer

    with patch.object(
        summarizer.client.messages, "create", new=AsyncMock(return_value=_Response("Elena arrives."))
    ):
        assert await summarizer.summarize_node("Long chapter prose.") == "Elena arrives."


@pytest.mark.asyncio
async def test_summarize_sends_the_body():
    from backend.agents import summarizer

    mock = AsyncMock(return_value=_Response("s"))
    with patch.object(summarizer.client.messages, "create", new=mock):
        await summarizer.summarize_node("The gates stood open.")
    assert "The gates stood open." in mock.call_args.kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_summarize_raises_on_empty_content():
    from backend.agents import summarizer

    empty = _Response("x")
    empty.content = []
    with patch.object(summarizer.client.messages, "create", new=AsyncMock(return_value=empty)):
        with pytest.raises(ValueError):
            await summarizer.summarize_node("prose")
```

In `tests/test_planner.py`, `tests/test_drafter.py`, and `tests/test_checker.py`,
replace every assertion that reaches into the structured bible. The rule: the
prompt must contain the bible **text**. Add to `tests/test_planner.py`:

```python
@pytest.mark.asyncio
async def test_planner_sends_bible_markdown(base_state):
    from backend.agents import planner

    mock = AsyncMock(return_value=_plan_response())
    with patch.object(planner.client.messages, "create", new=mock):
        await planner.planner_node(base_state)
    content = mock.call_args.kwargs["messages"][0]["content"]
    assert "### Elena" in content
    assert "Elena arrives at the Citadel gates" in content
```

Add to `tests/test_drafter.py`:

```python
def test_drafter_prompt_carries_bible_text(base_state, sample_scene_plan):
    from backend.agents.drafter import _build_messages

    base_state["scene_plan"] = sample_scene_plan
    system_prompt, user_content = _build_messages(base_state)
    assert "sparse and precise" in system_prompt or "sparse and precise" in user_content
    assert "adverbs ending in -ly" in system_prompt or "adverbs ending in -ly" in user_content
    assert "I won't wait." in user_content


def test_drafter_revision_branch_still_triggers(base_state, sample_scene_plan):
    from backend.agents.drafter import _build_messages

    base_state["scene_plan"] = sample_scene_plan
    base_state["draft"] = "Existing prose."
    base_state["continuity_issues"] = [
        {"issue": "Wrong hand", "severity": "critical", "location": "p2", "suggested_fix": "left"}
    ]
    _, user_content = _build_messages(base_state)
    assert "Wrong hand" in user_content
    assert "Existing prose." in user_content
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_summarizer.py tests/test_drafter.py -v`
Expected: FAIL — `No module named 'backend.agents.summarizer'`, and the drafter
tests fail on `AttributeError: 'str' object has no attribute 'get'`.

- [ ] **Step 4: Rewrite the three agents**

In `backend/agents/planner.py`, drop `import yaml` and replace the `messages` content:

```python
async def planner_node(state: dict) -> dict:
    summaries = state["previous_summaries"]
    summaries_text = (
        "\n\n".join(f"Chapter {i + 1} summary:\n{s}" for i, s in enumerate(summaries))
        if summaries
        else "No previous chapters."
    )

    response = await client.messages.create(
        model=get_model(),
        max_tokens=1024,
        system=(
            "You are a narrative architect. Create precise, concrete scene plans "
            "that give a prose writer everything they need without constraining their language."
        ),
        tools=[_PLAN_TOOL],
        tool_choice={"type": "tool", "name": "create_scene_plan"},
        messages=[
            {
                "role": "user",
                "content": (
                    f"Create a scene plan for this chapter beat:\n\n"
                    f"OUTLINE BEAT: {state['outline_beat']}\n\n"
                    f"STORY BIBLE:\n{state['story_bible']}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}"
                ),
            }
        ],
    )

    tool_use = next((b for b in response.content if b.type == "tool_use"), None)
    if tool_use is None:
        raise RuntimeError(f"Claude did not return a tool_use block; content={response.content!r}")
    return {"scene_plan": tool_use.input}
```

In `backend/agents/drafter.py`, replace `_build_messages` up to the `if is_revision:`
branch. Delete the `avoid_lines`, `dialogue_blocks`, and `style` locals:

```python
def _build_messages(state: dict) -> tuple[str, str]:
    """Build (system_prompt, user_content) for the drafter. Shared by the
    blocking node and the streaming generator so prompt logic stays identical."""
    bible = state["story_bible"]
    plan = state["scene_plan"]
    summaries = state["previous_summaries"]
    last_summary = summaries[-1] if summaries else "This is the first chapter."
    beats_text = "\n".join(f"- {b}" for b in plan.get("beats", []))

    existing_draft = state.get("draft", "")
    issues = state.get("continuity_issues", [])
    is_revision = bool(existing_draft and issues)

    if is_revision:
        issues_text = "\n".join(
            f"- [{i['severity'].upper()}] {i['issue']} (at {i['location']}): {i['suggested_fix']}"
            for i in issues
        )
        system_prompt = (
            "You are revising a chapter of literary fiction.\n"
            "Follow the voice and prose rules given in the story bible below.\n\n"
            f"STORY BIBLE:\n{bible}\n\n"
            "Fix all continuity issues listed below while preserving the overall narrative, characters, and style.\n"
            "Write only the revised prose. No commentary, no meta-text, no titles."
        )
        user_content = (
            f"Revise this draft to fix the following continuity issues.\n\n"
            f"CONTINUITY ISSUES TO FIX:\n{issues_text}\n\n"
            f"SCENE PLAN (for reference):\n"
            f"Goal: {plan.get('goal', '')}\n"
            f"POV: {plan.get('pov_character', '')}\n"
            f"Location: {plan.get('location', '')}\n\n"
            f"CURRENT DRAFT:\n{existing_draft}"
        )
    else:
        system_prompt = (
            "You are writing literary fiction.\n"
            "Follow the voice and prose rules given in the story bible below, and give "
            "each character the speech patterns their dialogue examples establish.\n\n"
            f"STORY BIBLE:\n{bible}\n\n"
            "Write only the prose. No commentary, no meta-text, no titles."
        )
        user_content = (
            f"Write this scene as prose.\n\n"
            f"SCENE PLAN:\n"
            f"Goal: {plan.get('goal', '')}\n"
            f"POV: {plan.get('pov_character', '')}\n"
            f"Location: {plan.get('location', '')}\n"
            f"Beats:\n{beats_text}\n"
            f"Opening image: {plan.get('opening_image', '')}\n"
            f"Closing image: {plan.get('closing_image', '')}\n"
            f"Sensory anchor: {plan.get('sensory_anchor', '')}\n\n"
            f"PREVIOUS CHAPTER:\n{last_summary}\n\n"
            f"STORY BIBLE:\n{bible}"
        )

    return system_prompt, user_content
```

In `backend/agents/checker.py`, drop `import yaml` and replace the four `yaml.dump`
lines in the message content:

```python
                "content": (
                    f"Check this draft for continuity issues.\n\n"
                    f"DRAFT:\n{state['draft']}\n\n"
                    f"SCENE PLAN (expected POV, location, beats):\n"
                    f"POV: {state['scene_plan'].get('pov_character', '')}\n"
                    f"Location: {state['scene_plan'].get('location', '')}\n"
                    f"Beats: {', '.join(state['scene_plan'].get('beats', []))}\n\n"
                    f"STORY BIBLE (character facts, world rules, timeline, style rules):\n"
                    f"{state['story_bible']}\n\n"
                    f"PREVIOUS CHAPTERS:\n{summaries_text}\n\n"
                    "Check for: physical trait contradictions, timeline inconsistencies, "
                    "character knowledge errors (knowing something they shouldn't), "
                    "location consistency errors."
                ),
```

- [ ] **Step 5: Write the summarizer**

Create `backend/agents/summarizer.py`:

```python
import anthropic

from backend.settings import get_model

client = anthropic.AsyncAnthropic()


async def summarize_node(text: str) -> str:
    """Condense a chapter body into the continuity-relevant facts the planner,
    drafter, and checker need from prior chapters."""
    response = await client.messages.create(
        model=get_model(),
        max_tokens=512,
        system=(
            "You summarize chapters of a novel for a continuity system. Record plot "
            "events, what each character now knows, and any physical, spatial, or "
            "temporal facts established. Omit prose style and atmosphere. "
            "Write a compact paragraph. No preamble."
        ),
        messages=[{"role": "user", "content": f"Summarize this chapter:\n\n{text}"}],
    )
    if not response.content:
        raise ValueError(
            f"Summarizer received empty content from API (stop_reason={response.stop_reason!r})"
        )
    return response.content[0].text
```

- [ ] **Step 6: Run the agent tests to verify they pass**

Run: `uv run pytest tests/test_planner.py tests/test_drafter.py tests/test_checker.py tests/test_summarizer.py -v`
Expected: PASS. Fix any remaining assertion in those files that still expects a dict bible.

- [ ] **Step 7: Commit**

```bash
git add backend/agents/ tests/test_planner.py tests/test_drafter.py tests/test_checker.py tests/test_summarizer.py tests/conftest.py
git commit -m "feat: agents read a markdown story bible; add chapter summarizer"
```

---

### Task 6: Prior-chapter context builder

**Files:**
- Create: `backend/context.py`
- Test: `tests/test_context.py`

**Interfaces:**
- Consumes: `Document`, `body_hash` (Task 3), `summarize_node` (Task 5)
- Produces: `MAX_PRIOR_CHAPTERS: int = 10`; `async build_previous_summaries(db, project_id, position) -> list[str]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_context.py`:

```python
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def project(db):
    from backend.db_models import Project, User

    user = User(email="ctx@test.com", hashed_password="x")
    db.add(user)
    await db.flush()
    project = Project(user_id=user.id, name="P")
    db.add(project)
    await db.commit()
    return project


async def _chapter(db, project_id, position, body, **kw):
    from backend.db_models import Document

    doc = Document(
        project_id=project_id, title=f"Ch {position}", kind="chapter",
        body=body, position=position, **kw,
    )
    db.add(doc)
    await db.commit()
    return doc


@pytest.mark.asyncio
async def test_summarizes_preceding_chapters_in_order(db, project):
    from backend.context import build_previous_summaries

    await _chapter(db, project.id, 1, "First.")
    await _chapter(db, project.id, 2, "Second.")

    with patch("backend.context.summarize_node", new=AsyncMock(side_effect=lambda t: f"sum:{t}")):
        result = await build_previous_summaries(db, project.id, position=3)
    assert result == ["sum:First.", "sum:Second."]


@pytest.mark.asyncio
async def test_reuses_a_cached_summary(db, project):
    from backend.context import build_previous_summaries
    from backend.doc_storage import body_hash

    await _chapter(db, project.id, 1, "First.", summary="cached", summary_hash=body_hash("First."))

    mock = AsyncMock(side_effect=lambda t: "fresh")
    with patch("backend.context.summarize_node", new=mock):
        result = await build_previous_summaries(db, project.id, position=2)
    assert result == ["cached"]
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_stale_hash_triggers_resummarize(db, project):
    from backend.context import build_previous_summaries

    await _chapter(db, project.id, 1, "Edited body.", summary="old", summary_hash="deadbeef")

    with patch("backend.context.summarize_node", new=AsyncMock(return_value="fresh")):
        assert await build_previous_summaries(db, project.id, position=2) == ["fresh"]


@pytest.mark.asyncio
async def test_skips_notes_empty_bodies_and_later_chapters(db, project):
    from backend.context import build_previous_summaries
    from backend.db_models import Document

    await _chapter(db, project.id, 1, "")  # empty
    db.add(Document(project_id=project.id, title="N", kind="note", body="Research.", position=2))
    await db.commit()
    await _chapter(db, project.id, 4, "Later.")  # after the target

    with patch("backend.context.summarize_node", new=AsyncMock(return_value="s")):
        assert await build_previous_summaries(db, project.id, position=3) == []


@pytest.mark.asyncio
async def test_caps_at_the_ten_nearest(db, project):
    from backend.context import MAX_PRIOR_CHAPTERS, build_previous_summaries

    for i in range(1, 15):
        await _chapter(db, project.id, i, f"Body {i}.")

    with patch("backend.context.summarize_node", new=AsyncMock(side_effect=lambda t: t)):
        result = await build_previous_summaries(db, project.id, position=15)
    assert len(result) == MAX_PRIOR_CHAPTERS
    assert result[0] == "Body 5."
    assert result[-1] == "Body 14."
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_context.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.context'`

- [ ] **Step 3: Write the implementation**

Create `backend/context.py`:

```python
import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.summarizer import summarize_node
from backend.db_models import Document
from backend.doc_storage import body_hash

# Without a cap, the first generation on chapter 30 fires 29 model calls.
MAX_PRIOR_CHAPTERS = 10


async def build_previous_summaries(
    db: AsyncSession, project_id: uuid.UUID, position: int
) -> list[str]:
    """Summaries of the chapter documents preceding `position`, in order.

    Reuses a document's cached summary while its body is unchanged; summarizes
    the stale ones concurrently and writes the new summaries back."""
    result = await db.execute(
        select(Document)
        .where(
            Document.project_id == project_id,
            Document.kind == "chapter",
            Document.position < position,
            Document.body != "",
        )
        .order_by(Document.position)
    )
    documents = list(result.scalars())[-MAX_PRIOR_CHAPTERS:]

    stale = [d for d in documents if d.summary is None or d.summary_hash != body_hash(d.body)]
    if stale:
        summaries = await asyncio.gather(*(summarize_node(d.body) for d in stale))
        for document, summary in zip(stale, summaries):
            document.summary = summary
            document.summary_hash = body_hash(document.body)
        await db.commit()

    return [d.summary for d in documents]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_context.py -v`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/context.py tests/test_context.py
git commit -m "feat: build prior-chapter context from documents with summary caching"
```

---

### Task 7: Generation router

**Files:**
- Create: `backend/routes/generate.py`
- Modify: `backend/main.py` (mount)
- Test: `tests/test_generate_api.py`

**Interfaces:**
- Consumes: Tasks 3, 5, 6
- Produces: `router` (APIRouter) serving `plan`, `draft/stream`, `check`, `revise/stream` under `/projects/{project_id}/documents/{document_id}`

- [ ] **Step 1: Write the failing test**

Create `tests/test_generate_api.py`:

```python
import json
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio


def _parse_sse(text: str) -> list[dict]:
    return [
        json.loads(chunk.replace("data: ", ""))
        for chunk in text.split("\n\n")
        if chunk.strip()
    ]


@pytest_asyncio.fixture
async def chapter(authed_client):
    """(client, project_id, document_id) for a chapter with a brief."""
    client, project_id = authed_client
    doc_id = (
        await client.post(f"/projects/{project_id}/documents", json={"title": "Chapter 1"})
    ).json()["id"]
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}", json={"brief": "Elena reaches the gates."}
    )
    return client, project_id, doc_id


@pytest.mark.asyncio
async def test_generate_plan_persists_to_the_document(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    with patch(
        "backend.routes.generate.planner_node",
        new=AsyncMock(return_value={"scene_plan": sample_scene_plan}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert resp.status_code == 200
    assert resp.json()["plan"]["pov_character"] == "Elena"

    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["plan"]["pov_character"] == "Elena"


@pytest.mark.asyncio
async def test_plan_uses_the_document_brief_not_an_outline(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    mock = AsyncMock(return_value={"scene_plan": sample_scene_plan})
    with patch("backend.routes.generate.planner_node", new=mock):
        await client.post(f"/projects/{project_id}/documents/{doc_id}/plan")
    assert mock.call_args.args[0]["outline_beat"] == "Elena reaches the gates."


@pytest.mark.asyncio
async def test_plan_on_a_note_returns_400(authed_client):
    client, project_id = authed_client
    note = (await client.post(f"/projects/{project_id}/documents", json={"kind": "note"})).json()["id"]
    resp = await client.post(f"/projects/{project_id}/documents/{note}/plan")
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_draft_stream_appends_to_the_body(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    await client.patch(f"/projects/{project_id}/documents/{doc_id}", json={"body": "Existing."})

    async def fake_stream(state):
        for text in ["New ", "prose."]:
            yield text

    with patch("backend.routes.generate.drafter_token_stream", new=fake_stream):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/draft/stream",
            json={"plan": sample_scene_plan},
        )
    frames = _parse_sse(resp.text)
    assert [f["text"] for f in frames if f["type"] == "delta"] == ["New ", "prose."]
    done = next(f for f in frames if f["type"] == "done")
    assert done["body"] == "Existing.\n\nNew prose."

    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["body"] == "Existing.\n\nNew prose."


@pytest.mark.asyncio
async def test_draft_stream_fills_an_empty_body_without_leading_blank_lines(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter

    async def fake_stream(state):
        yield "Only prose."

    with patch("backend.routes.generate.drafter_token_stream", new=fake_stream):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/draft/stream",
            json={"plan": sample_scene_plan},
        )
    assert next(f for f in _parse_sse(resp.text) if f["type"] == "done")["body"] == "Only prose."


@pytest.mark.asyncio
async def test_draft_stream_persists_the_plan_it_receives(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter

    async def fake_stream(state):
        yield "x"

    with patch("backend.routes.generate.drafter_token_stream", new=fake_stream):
        await client.post(
            f"/projects/{project_id}/documents/{doc_id}/draft/stream",
            json={"plan": sample_scene_plan},
        )
    doc = (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()
    assert doc["plan"]["goal"] == sample_scene_plan["goal"]


@pytest.mark.asyncio
async def test_draft_stream_emits_an_error_frame(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter

    async def boom(state):
        raise RuntimeError("model exploded")
        yield  # pragma: no cover — makes this an async generator

    with patch("backend.routes.generate.drafter_token_stream", new=boom):
        resp = await client.post(
            f"/projects/{project_id}/documents/{doc_id}/draft/stream",
            json={"plan": sample_scene_plan},
        )
    error = next(f for f in _parse_sse(resp.text) if f["type"] == "error")
    assert "model exploded" in error["detail"]


@pytest.mark.asyncio
async def test_check_reads_the_body_and_persists_issues(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={"body": "Elena raised her right hand.", "plan": sample_scene_plan},
    )
    issues = [
        {"issue": "Elena is left-handed", "severity": "critical",
         "location": "para 1", "suggested_fix": "left hand"}
    ]
    with patch(
        "backend.routes.generate.checker_node",
        new=AsyncMock(return_value={"continuity_issues": issues}),
    ):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/check")
    assert resp.json()["issues"] == issues
    assert (await client.get(f"/projects/{project_id}/documents/{doc_id}")).json()["issues"] == issues


@pytest.mark.asyncio
async def test_revise_stream_replaces_the_body(chapter, sample_scene_plan):
    client, project_id, doc_id = chapter
    await client.patch(
        f"/projects/{project_id}/documents/{doc_id}",
        json={
            "body": "Elena raised her right hand.",
            "plan": sample_scene_plan,
            "issues": [{"issue": "handedness", "severity": "critical",
                        "location": "p1", "suggested_fix": "left"}],
        },
    )

    async def fake_stream(state):
        yield "Elena raised her left hand."

    with patch("backend.routes.generate.drafter_token_stream", new=fake_stream):
        resp = await client.post(f"/projects/{project_id}/documents/{doc_id}/revise/stream")
    done = next(f for f in _parse_sse(resp.text) if f["type"] == "done")
    assert done["body"] == "Elena raised her left hand."
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_generate_api.py -v`
Expected: FAIL — 404 on every generation route.

- [ ] **Step 3: Write the router**

Create `backend/routes/generate.py`:

```python
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.checker import checker_node
from backend.agents.drafter import drafter_token_stream
from backend.agents.planner import planner_node
from backend.context import build_previous_summaries
from backend.db import get_db
from backend.db_models import Document, Project
from backend.doc_storage import get_bible_body, get_document
from backend.routes.deps import require_project

router = APIRouter(prefix="/projects/{project_id}/documents/{document_id}", tags=["generate"])


class PlanBody(BaseModel):
    plan: dict


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


_SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


async def _require_chapter(db: AsyncSession, project_id: uuid.UUID, document_id: uuid.UUID) -> Document:
    document = await get_document(db, project_id, document_id)
    if document.kind != "chapter":
        raise HTTPException(
            status_code=400, detail=f"Cannot generate on a {document.kind} document"
        )
    return document


async def _base_state(db: AsyncSession, document: Document) -> dict:
    """Assemble agent state from documents. Replaces the old outline-index lookup:
    the beat comes from the document's own brief, so a chapter can sit anywhere."""
    return {
        "outline_beat": document.brief,
        "story_bible": await get_bible_body(db, document.project_id),
        "previous_summaries": await build_previous_summaries(
            db, document.project_id, document.position
        ),
        "scene_plan": document.plan or {},
        "draft": "",
        "continuity_issues": [],
    }


@router.post("/plan")
async def generate_plan(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    result = await planner_node(state)
    document.plan = result["scene_plan"]
    await db.commit()
    return {"plan": result["scene_plan"]}


@router.post("/check")
async def generate_check(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    state["draft"] = document.body
    result = await checker_node(state)
    document.issues = result["continuity_issues"]
    await db.commit()
    return {"issues": result["continuity_issues"]}


@router.post("/draft/stream")
async def generate_draft_stream(
    document_id: uuid.UUID,
    body: PlanBody,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    # Persist the plan first, so a panel edit survives a failed stream.
    document.plan = body.plan
    await db.commit()

    state = await _base_state(db, document)
    state["scene_plan"] = body.plan
    existing = document.body

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            draft = "".join(buf)
            document.body = f"{existing}\n\n{draft}" if existing else draft
            document.summary_hash = None  # body changed; cached summary is stale
            await db.commit()
            yield _sse({"type": "done", "body": document.body})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/revise/stream")
async def revise_stream(
    document_id: uuid.UUID,
    project: Project = Depends(require_project),
    db: AsyncSession = Depends(get_db),
):
    document = await _require_chapter(db, project.id, document_id)
    state = await _base_state(db, document)
    # Both set => drafter_node takes its revision branch.
    state["draft"] = document.body
    state["continuity_issues"] = document.issues or []

    async def gen():
        buf = []
        try:
            async for text in drafter_token_stream(state):
                buf.append(text)
                yield _sse({"type": "delta", "text": text})
            # A revision replaces the text wholesale rather than appending.
            document.body = "".join(buf)
            document.summary_hash = None
            await db.commit()
            yield _sse({"type": "done", "body": document.body})
        except Exception as e:
            yield _sse({"type": "error", "detail": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)
```

- [ ] **Step 4: Mount the router**

In `backend/main.py`:

```python
from backend.routes import documents as documents_routes, generate as generate_routes

app.include_router(documents_routes.router)
app.include_router(generate_routes.router)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_generate_api.py -v`
Expected: PASS — 9 passed

- [ ] **Step 6: Commit**

```bash
git add backend/routes/generate.py backend/main.py tests/test_generate_api.py
git commit -m "feat: document-scoped plan, draft, check, and revise routes"
```

---

### Task 8: Remove the legacy backend surface

**Files:**
- Modify: `backend/main.py`
- Delete: `backend/storage.py`, `backend/db_storage.py`
- Modify: `backend/models.py`
- Delete: `tests/test_storage.py`; rewrite `tests/test_api.py`

**Interfaces:**
- Consumes: everything above
- Produces: `main.py` serving only auth, projects, health, SPA, and the two routers

- [ ] **Step 1: Delete the legacy routes from `main.py`**

Remove these endpoint functions entirely: `get_bible`, `update_bible`, `get_outline`,
`update_outline`, `generate_plan`, `generate_draft`, `generate_check`, `revise_draft`,
`generate_draft_stream`, `revise_draft_stream`, `get_draft_state`, `accept_chapter`,
`get_chapter`, and the module-level helpers `_require_project`, `_base_state`, `_sse`,
`_SSE_HEADERS`. Remove the now-unused imports of `checker_node`, `drafter_node`,
`drafter_token_stream`, `planner_node`, every name from `backend.db_storage`, and
every name from `backend.models`. Keep `json` only if still referenced (it is not —
remove it).

What remains: `lifespan`, the app + static mounts, `RegisterRequest`, `TokenResponse`,
`register`, `login`, `ProjectCreateRequest`, `create_project`, `list_projects`,
`get_project`, the two `include_router` calls, `_serve_spa`, `health`, `root`,
`spa_fallback`.

- [ ] **Step 2: Delete dead modules**

```bash
git rm backend/storage.py backend/db_storage.py tests/test_storage.py
```

`backend/storage.py` had no importers even before this change. `db_storage.py` is
now unreferenced — Task 3's `doc_storage.py` replaces it.

- [ ] **Step 3: Trim `backend/models.py`**

Delete `ChapterState`, `GenerateResponse`, `CharacterData`, `WorldData`,
`StyleGuideData`, `BibleUpdateRequest`, `OutlineUpdateRequest`, `DraftRequest`,
`CheckRequest`, `ReviseRequest`, `AcceptRequest`, and `DraftStateResponse` — every
one is now unreferenced. If the file ends up empty, delete it with
`git rm backend/models.py`.

- [ ] **Step 4: Rewrite `tests/test_api.py`**

Keep only the tests that still describe live behavior: `test_register_and_login`,
`test_register_duplicate_email`, `test_list_projects`, `test_get_project`,
`test_unauthorized_access`, `test_project_not_accessible_by_other_user`. Delete
`test_get_bible`, `test_put_bible`, `test_accept_chapter`, `test_get_chapter_not_found`,
`test_get_chapter_after_accept`, `test_chapter_state_empty`,
`test_generate_plan_chapter_out_of_range`, `test_draft_stream_emits_deltas_done_and_persists`,
`test_revise_stream_emits_done`, `test_draft_stream_error_frame`,
`test_accept_guard_blocks_then_overwrite`, and `test_outline_get_and_put` — Tasks 4
and 7 cover their replacements.

Update `test_get_project` to assert the trimmed response:

```python
@pytest.mark.asyncio
async def test_get_project(authed_client):
    client, project_id = authed_client
    resp = await client.get(f"/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json() == {"project_id": project_id, "name": "Test Novel"}
```

- [ ] **Step 5: Run the full backend suite**

Run: `uv run pytest -v`
Expected: PASS — all tests green, no import errors.

- [ ] **Step 6: Commit**

```bash
git add -A backend/ tests/
git commit -m "refactor: remove bible, outline, and chapter-workflow routes"
```

---

### Task 9: Frontend API layer

**Files:**
- Modify: `frontend/src/api/client.ts` (PATCH/DELETE), `frontend/src/api/stream.ts` (`done.body`), `frontend/src/api/types.ts`, `frontend/src/api/endpoints.ts`, `frontend/src/hooks/queries.ts`
- Delete: `frontend/src/api/bible-types.ts`, `frontend/src/api/bible-types.test.ts`
- Test: `frontend/src/api/endpoints.test.ts` (extend)

**Interfaces:**
- Consumes: the Task 4 and 7 routes
- Produces: `DocumentSummary`, `DocumentDetail`, `DocumentKind` types; `listDocuments`, `getDocument`, `createDocument`, `updateDocument`, `deleteDocument`, `reorderDocuments`, `generatePlan`, `checkDocument`, `draftStreamUrl`, `reviseStreamUrl`; hooks `useDocuments`, `useDocument`, `useCreateDocument`, `useDeleteDocument`, `useReorderDocuments`, `documentsKey`, `documentKey`.

Saving is deliberately **not** a hook: `WorkspaceScreen` calls `updateDocument` directly so it can hold the in-flight promise in a ref and await it before opening a stream.

- [ ] **Step 1: Widen the request method union**

In `frontend/src/api/client.ts`:

```typescript
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

No other change — the existing empty-body guard already returns `null` for a 204.

- [ ] **Step 2: Change the SSE done frame**

In `frontend/src/api/stream.ts`, the server now sends the full document body:

```typescript
export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onDone: (body: string) => void;
}

interface DoneFrame {
  type: 'done';
  body: string;
}
```

and in the frame loop:

```typescript
      else if (evt.type === 'done') onDone(evt.body);
```

- [ ] **Step 3: Write the failing test**

Append to `frontend/src/api/endpoints.test.ts`:

```typescript
describe('document endpoints', () => {
  it('creates a document with the given title and kind', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'd1', title: 'Ch 1', kind: 'chapter' }), { status: 201 }),
    );
    const { createDocument } = await import('./endpoints');

    const doc = await createDocument('p1', 'Ch 1', 'chapter');

    expect(doc.id).toBe('d1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'Ch 1', kind: 'chapter' });
  });

  it('patches only the fields it is given', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'd1' }), { status: 200 }),
    );
    const { updateDocument } = await import('./endpoints');

    await updateDocument('p1', 'd1', { body: 'text' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents/d1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'text' });
  });

  it('sends the id order when reordering', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 204 }),
    );
    const { reorderDocuments } = await import('./endpoints');

    await reorderDocuments('p1', ['b', 'a']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/projects/p1/documents/order');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ document_ids: ['b', 'a'] });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api/endpoints.test.ts`
Expected: FAIL — `createDocument is not a function`

- [ ] **Step 5: Add the document types**

In `frontend/src/api/types.ts`, delete `DraftState`, `SavedChapter`, `Step`, and the
`bible_content` / `outline_content` fields on `ProjectDetail`; add:

```typescript
export type DocumentKind = 'bible' | 'chapter' | 'note';

/** A row in the sidebar, from GET /projects/{id}/documents. */
export interface DocumentSummary {
  id: string;
  title: string;
  kind: DocumentKind;
  position: number;
  updated_at: string;
}

/** A single open document, from GET /projects/{id}/documents/{did}. */
export interface DocumentDetail extends DocumentSummary {
  body: string;
  brief: string;
  plan: ScenePlan | null;
  issues: Issue[] | null;
}
```

`ProjectDetail` becomes:

```typescript
export interface ProjectDetail {
  project_id: string;
  name: string;
}
```

`ScenePlan`, `Issue`, `Severity`, `SEVERITIES`, `EMPTY_PLAN`, and `ProjectSummary`
stay exactly as they are.

- [ ] **Step 6: Rewrite the endpoints**

In `frontend/src/api/endpoints.ts`, delete `getBible`, `saveBible`, `getOutline`,
`saveOutline`, `getChapter`, `getDraftState`, `acceptChapter`, `checkDraft`, and the
old `generatePlan`. Change `createProject` to take only a name. Add:

```typescript
// ── documents ────────────────────────────────────────────────────────────────
export const listDocuments = (projectId: string) =>
  request<DocumentSummary[]>(`/projects/${projectId}/documents`);

export const getDocument = (projectId: string, documentId: string) =>
  request<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`);

export const createDocument = (projectId: string, title?: string, kind: DocumentKind = 'chapter') =>
  request<DocumentDetail>(`/projects/${projectId}/documents`, {
    method: 'POST',
    body: { title, kind },
  });

export type DocumentPatch = Partial<
  Pick<DocumentDetail, 'title' | 'body' | 'brief' | 'plan' | 'issues' | 'kind'>
>;

export const updateDocument = (projectId: string, documentId: string, patch: DocumentPatch) =>
  request<DocumentDetail>(`/projects/${projectId}/documents/${documentId}`, {
    method: 'PATCH',
    body: patch,
  });

export const deleteDocument = (projectId: string, documentId: string) =>
  request<null>(`/projects/${projectId}/documents/${documentId}`, { method: 'DELETE' });

export const reorderDocuments = (projectId: string, documentIds: string[]) =>
  request<null>(`/projects/${projectId}/documents/order`, {
    method: 'PUT',
    body: { document_ids: documentIds },
  });

// ── generation (per document) ────────────────────────────────────────────────
export const generatePlan = (projectId: string, documentId: string) =>
  request<{ plan: ScenePlan }>(`/projects/${projectId}/documents/${documentId}/plan`, {
    method: 'POST',
  });

export const checkDocument = (projectId: string, documentId: string) =>
  request<{ issues: Issue[] }>(`/projects/${projectId}/documents/${documentId}/check`, {
    method: 'POST',
  });

export const draftStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/draft/stream`;

export const reviseStreamUrl = (projectId: string, documentId: string) =>
  `/projects/${projectId}/documents/${documentId}/revise/stream`;
```

Update the import block at the top to pull `DocumentDetail`, `DocumentKind`,
`DocumentSummary`, `Issue`, `ProjectDetail`, `ProjectSummary`, `ScenePlan` from
`./types`, and delete the `./bible-types` import.

- [ ] **Step 7: Rewrite the query hooks**

Replace the contents of `frontend/src/hooks/queries.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  reorderDocuments,
} from '../api/endpoints';
import type { DocumentKind } from '../api/types';

export const documentsKey = (projectId: string) => ['documents', projectId] as const;
export const documentKey = (projectId: string, documentId: string) =>
  ['document', projectId, documentId] as const;

export function useDocuments(projectId: string) {
  return useQuery({
    queryKey: documentsKey(projectId),
    queryFn: () => listDocuments(projectId),
  });
}

export function useDocument(projectId: string, documentId: string | undefined) {
  return useQuery({
    queryKey: documentKey(projectId, documentId ?? ''),
    queryFn: () => getDocument(projectId, documentId!),
    enabled: !!documentId,
  });
}

export function useCreateDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { title?: string; kind?: DocumentKind }) =>
      createDocument(projectId, vars.title, vars.kind ?? 'chapter'),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}

export function useDeleteDocument(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(projectId, documentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}

export function useReorderDocuments(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentIds: string[]) => reorderDocuments(projectId, documentIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: documentsKey(projectId) }),
  });
}
```

- [ ] **Step 8: Delete the bible types**

```bash
cd frontend && git rm src/api/bible-types.ts src/api/bible-types.test.ts
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/api/`
Expected: PASS. Type errors elsewhere are expected at this point — Tasks 10-13 fix them.

- [ ] **Step 10: Commit**

```bash
git add -A frontend/src/api frontend/src/hooks/queries.ts
git commit -m "feat: document API client, types, and query hooks"
```

---

### Task 10: DocumentSidebar

**Files:**
- Create: `frontend/src/components/DocumentSidebar.tsx`
- Test: `frontend/src/components/DocumentSidebar.test.tsx`

**Interfaces:**
- Consumes: `DocumentSummary`, `DocumentKind` (Task 9)
- Produces:

```typescript
interface DocumentSidebarProps {
  documents: DocumentSummary[];
  activeId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}
export function DocumentSidebar(props: DocumentSidebarProps): JSX.Element
```

Drag-and-drop uses native HTML5 `draggable` — no new dependency.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/DocumentSidebar.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentSidebar } from './DocumentSidebar';
import type { DocumentSummary } from '../api/types';

const DOCS: DocumentSummary[] = [
  { id: 'b', title: 'Story Bible', kind: 'bible', position: 0, updated_at: '2026-01-01' },
  { id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1, updated_at: '2026-01-01' },
  { id: 'n1', title: 'Research', kind: 'note', position: 2, updated_at: '2026-01-01' },
];

function setup(overrides = {}) {
  const props = {
    documents: DOCS,
    activeId: 'c1',
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    ...overrides,
  };
  render(<DocumentSidebar {...props} />);
  return props;
}

describe('DocumentSidebar', () => {
  it('lists every document', () => {
    setup();
    expect(screen.getByText('Story Bible')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('selects a document on click', async () => {
    const props = setup();
    await userEvent.click(screen.getByText('Research'));
    expect(props.onSelect).toHaveBeenCalledWith('n1');
  });

  it('creates a document from the new button', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: /new document/i }));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it('renames on double-click and Enter', async () => {
    const props = setup();
    await userEvent.dblClick(screen.getByText('Chapter 1'));
    const input = screen.getByDisplayValue('Chapter 1');
    await userEvent.clear(input);
    await userEvent.type(input, 'The Gates{Enter}');
    expect(props.onRename).toHaveBeenCalledWith('c1', 'The Gates');
  });

  it('abandons a rename on Escape', async () => {
    const props = setup();
    await userEvent.dblClick(screen.getByText('Chapter 1'));
    await userEvent.type(screen.getByDisplayValue('Chapter 1'), '{Escape}');
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it('deletes behind a confirm', async () => {
    const props = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByTitle('Delete Chapter 1'));
    expect(props.onDelete).toHaveBeenCalledWith('c1');
  });

  it('does not delete when the confirm is declined', async () => {
    const props = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByTitle('Delete Chapter 1'));
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('offers no delete control for the story bible', () => {
    setup();
    expect(screen.queryByTitle('Delete Story Bible')).not.toBeInTheDocument();
  });

  it('collapses to icons only', () => {
    setup({ collapsed: true });
    expect(screen.queryByText('Chapter 1')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/DocumentSidebar.test.tsx`
Expected: FAIL — cannot resolve `./DocumentSidebar`

- [ ] **Step 3: Write the component**

Create `frontend/src/components/DocumentSidebar.tsx`:

```typescript
import { useState } from 'react';
import type { DocumentSummary } from '../api/types';
import { cn } from '../lib/utils';

const KIND_ICON: Record<string, string> = { bible: '⊙', chapter: '•', note: '▫' };

interface DocumentSidebarProps {
  documents: DocumentSummary[];
  activeId: string | undefined;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

export function DocumentSidebar({
  documents,
  activeId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: DocumentSidebarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const commitRename = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
  };

  const drop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const ids = documents.map((d) => d.id).filter((id) => id !== draggingId);
    ids.splice(ids.indexOf(targetId), 0, draggingId);
    onReorder(ids);
    setDraggingId(null);
  };

  const bible = documents.filter((d) => d.kind === 'bible');
  const rest = documents.filter((d) => d.kind !== 'bible');

  const row = (doc: DocumentSummary, draggable: boolean) => (
    <li
      key={doc.id}
      draggable={draggable}
      onDragStart={() => setDraggingId(doc.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => drop(doc.id)}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        doc.id === activeId ? 'bg-blue-50 text-blue-900' : 'text-gray-700 hover:bg-gray-100',
      )}
    >
      <span className="w-3 flex-shrink-0 text-center text-xs text-gray-400">
        {KIND_ICON[doc.kind]}
      </span>
      {collapsed ? null : renamingId === doc.id ? (
        <input
          autoFocus
          defaultValue={doc.title}
          onBlur={(e) => commitRename(doc.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(doc.id, e.currentTarget.value);
            if (e.key === 'Escape') setRenamingId(null);
          }}
          className="min-w-0 flex-1 rounded border border-blue-300 px-1 py-0.5 text-sm"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(doc.id)}
            onDoubleClick={() => setRenamingId(doc.id)}
            className="min-w-0 flex-1 truncate text-left"
          >
            {doc.title}
          </button>
          {doc.kind !== 'bible' && (
            <button
              type="button"
              title={`Delete ${doc.title}`}
              onClick={() => {
                if (window.confirm(`Delete "${doc.title}"? This cannot be undone.`))
                  onDelete(doc.id);
              }}
              className="flex-shrink-0 px-1 text-xs text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </>
      )}
    </li>
  );

  return (
    <nav
      className={cn(
        'flex flex-shrink-0 flex-col gap-1 border-r border-gray-200 bg-[#fafaf7] py-2',
        collapsed ? 'w-11 px-1' : 'w-60 px-2',
      )}
    >
      <div className="flex items-center justify-between px-1 pb-1">
        {!collapsed && (
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Documents
          </span>
        )}
        <button
          type="button"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
          className="rounded px-1 text-xs text-gray-400 hover:bg-gray-200"
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <ul className="flex flex-col gap-0.5">{bible.map((d) => row(d, false))}</ul>
      {!collapsed && <div className="my-1 border-t border-gray-200" />}
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {rest.map((d) => row(d, true))}
      </ul>

      <button
        type="button"
        onClick={onCreate}
        title="New document"
        aria-label="New document"
        className="mt-1 rounded-md border border-dashed border-gray-300 py-1.5 text-[13px] text-gray-400 hover:bg-gray-100"
      >
        {collapsed ? '+' : '+ New document'}
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/DocumentSidebar.test.tsx`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DocumentSidebar.tsx frontend/src/components/DocumentSidebar.test.tsx
git commit -m "feat: document sidebar with rename, delete, and drag reordering"
```

---

### Task 11: DocumentEditor

**Files:**
- Create: `frontend/src/components/DocumentEditor.tsx`
- Test: `frontend/src/components/DocumentEditor.test.tsx`

**Interfaces:**
- Consumes: `DocumentDetail` (Task 9)
- Produces:

```typescript
interface DocumentEditorProps {
  document: DocumentDetail;
  readOnly: boolean;
  onSave: (patch: { title?: string; body?: string; brief?: string }) => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  bodyOverride?: string;   // set during streaming; bypasses local state
}
export function DocumentEditor(props: DocumentEditorProps): JSX.Element
export const AUTOSAVE_MS = 800;
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/DocumentEditor.test.tsx`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentEditor } from './DocumentEditor';
import type { DocumentDetail } from '../api/types';

const DOC: DocumentDetail = {
  id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1,
  updated_at: '2026-01-01', body: 'The rain.', brief: 'Mara waits.',
  plan: null, issues: null,
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe('DocumentEditor', () => {
  it('renders the title, brief, and body', () => {
    render(<DocumentEditor document={DOC} readOnly={false} onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByDisplayValue('Chapter 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Mara waits.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('The rain.')).toBeInTheDocument();
  });

  it('debounces the body save', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DocumentEditor document={DOC} readOnly={false} onSave={onSave} saveState="idle" />);

    await user.type(screen.getByDisplayValue('The rain.'), '!');
    expect(onSave).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(800));
    expect(onSave).toHaveBeenCalledWith({ body: 'The rain.!' });
  });

  it('hides the brief field on non-chapter documents', () => {
    render(
      <DocumentEditor
        document={{ ...DOC, kind: 'bible', brief: '' }}
        readOnly={false} onSave={vi.fn()} saveState="idle"
      />,
    );
    expect(screen.queryByPlaceholderText(/what happens/i)).not.toBeInTheDocument();
  });

  it('disables the body while read-only', () => {
    render(<DocumentEditor document={DOC} readOnly onSave={vi.fn()} saveState="idle" />);
    expect(screen.getByDisplayValue('The rain.')).toBeDisabled();
  });

  it('shows the streaming override instead of local state', () => {
    render(
      <DocumentEditor
        document={DOC} readOnly onSave={vi.fn()} saveState="idle"
        bodyOverride="The rain. Streaming…"
      />,
    );
    expect(screen.getByDisplayValue('The rain. Streaming…')).toBeInTheDocument();
  });

  it('reports the save state', () => {
    render(<DocumentEditor document={DOC} readOnly={false} onSave={vi.fn()} saveState="saving" />);
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/DocumentEditor.test.tsx`
Expected: FAIL — cannot resolve `./DocumentEditor`

- [ ] **Step 3: Write the component**

Create `frontend/src/components/DocumentEditor.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react';
import type { DocumentDetail } from '../api/types';

export const AUTOSAVE_MS = 800;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface DocumentEditorProps {
  document: DocumentDetail;
  readOnly: boolean;
  onSave: (patch: { title?: string; body?: string; brief?: string }) => void;
  saveState: SaveState;
  /** Live text during a stream. Bypasses local state so the server stays authoritative. */
  bodyOverride?: string;
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') return <span className="text-xs text-gray-400">Saving…</span>;
  if (state === 'saved') return <span className="text-xs text-green-600">Saved.</span>;
  if (state === 'error') return <span className="text-xs text-red-600">Error saving.</span>;
  return null;
}

export function DocumentEditor({
  document,
  readOnly,
  onSave,
  saveState,
  bodyOverride,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(document.title);
  const [brief, setBrief] = useState(document.brief);
  const [body, setBody] = useState(document.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt server state when the open document changes or a stream rewrites it.
  useEffect(() => {
    setTitle(document.title);
    setBrief(document.brief);
    setBody(document.body);
  }, [document.id, document.title, document.brief, document.body]);

  const queueSave = (patch: { title?: string; body?: string; brief?: string }) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(patch), AUTOSAVE_MS);
  };

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value });
          }}
          className="min-w-0 flex-1 border-none bg-transparent text-base font-semibold text-gray-800 outline-none"
        />
        <SaveIndicator state={saveState} />
      </div>

      {document.kind === 'chapter' && (
        <input
          value={brief}
          placeholder="What happens in this chapter…"
          onChange={(e) => {
            setBrief(e.target.value);
            queueSave({ brief: e.target.value });
          }}
          className="border-b border-gray-200 bg-[#fcfcfa] px-6 py-2 text-sm text-gray-600 outline-none"
        />
      )}

      <textarea
        value={bodyOverride ?? body}
        disabled={readOnly}
        onChange={(e) => {
          setBody(e.target.value);
          queueSave({ body: e.target.value });
        }}
        className="flex-1 resize-none bg-white px-6 py-6 font-serif text-[15px] leading-[1.8] text-gray-800 outline-none disabled:bg-gray-50"
      />
    </main>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/DocumentEditor.test.tsx`
Expected: PASS — 6 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DocumentEditor.tsx frontend/src/components/DocumentEditor.test.tsx
git commit -m "feat: document editor with debounced autosave"
```

---

### Task 12: ChapterToolbar and PlanPanel

**Files:**
- Create: `frontend/src/components/ChapterToolbar.tsx`, `frontend/src/components/PlanPanel.tsx`
- Test: `frontend/src/components/ChapterToolbar.test.tsx`, `frontend/src/components/PlanPanel.test.tsx`
- Delete: `frontend/src/components/ActionRow.tsx`, `StepBar.tsx`, `ChapterControls.tsx`, `SavedView.tsx`, `DraftEditor.tsx`

**Interfaces:**
- Consumes: `ScenePlan`, `Issue` (Task 9); reuses `PlanForm`, `IssuesList` unchanged
- Produces:

```typescript
export function ChapterToolbar(props: {
  busy: boolean;
  onGeneratePlan: () => void;
  onGenerateDraft: () => void;
  onCheck: () => void;
}): JSX.Element

export function PlanPanel(props: {
  plan: ScenePlan | null;
  issues: Issue[] | null;
  height: number;
  onHeightChange: (px: number) => void;
  onPlanChange: (plan: ScenePlan) => void;
  onIssuesChange: (issues: Issue[]) => void;
  onDrop: () => void;
  onGenerateDraft: () => void;
  onRevise: () => void;
  busy: boolean;
}): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ChapterToolbar.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterToolbar } from './ChapterToolbar';

describe('ChapterToolbar', () => {
  it('fires each action', async () => {
    const props = {
      busy: false,
      onGeneratePlan: vi.fn(),
      onGenerateDraft: vi.fn(),
      onCheck: vi.fn(),
    };
    render(<ChapterToolbar {...props} />);

    await userEvent.click(screen.getByRole('button', { name: /generate plan/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    await userEvent.click(screen.getByRole('button', { name: /check/i }));

    expect(props.onGeneratePlan).toHaveBeenCalled();
    expect(props.onGenerateDraft).toHaveBeenCalled();
    expect(props.onCheck).toHaveBeenCalled();
  });

  it('disables everything while busy', () => {
    render(
      <ChapterToolbar busy onGeneratePlan={vi.fn()} onGenerateDraft={vi.fn()} onCheck={vi.fn()} />,
    );
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });
});
```

Create `frontend/src/components/PlanPanel.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPanel } from './PlanPanel';
import { EMPTY_PLAN, type Issue } from '../api/types';

const ISSUES: Issue[] = [
  { issue: 'Wrong hand', severity: 'critical', location: 'p1', suggested_fix: 'left' },
];

function props(overrides = {}) {
  return {
    plan: { ...EMPTY_PLAN, goal: 'Escape' },
    issues: null,
    height: 240,
    onHeightChange: vi.fn(),
    onPlanChange: vi.fn(),
    onIssuesChange: vi.fn(),
    onDrop: vi.fn(),
    onGenerateDraft: vi.fn(),
    onRevise: vi.fn(),
    busy: false,
    ...overrides,
  };
}

describe('PlanPanel', () => {
  it('shows the plan fields', () => {
    render(<PlanPanel {...props()} />);
    expect(screen.getByDisplayValue('Escape')).toBeInTheDocument();
  });

  it('drops the plan', async () => {
    const p = props();
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /drop/i }));
    expect(p.onDrop).toHaveBeenCalled();
  });

  it('generates a draft from the plan', async () => {
    const p = props();
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    expect(p.onGenerateDraft).toHaveBeenCalled();
  });

  it('switches to the issues tab and offers revise', async () => {
    const p = props({ issues: ISSUES });
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /issues/i }));
    expect(screen.getByDisplayValue('Wrong hand')).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).toHaveBeenCalled();
  });

  it('does not revise when the confirm is declined', async () => {
    const p = props({ issues: ISSUES });
    render(<PlanPanel {...p} />);
    await userEvent.click(screen.getByRole('button', { name: /issues/i }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await userEvent.click(screen.getByRole('button', { name: /revise draft/i }));
    expect(p.onRevise).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ChapterToolbar.test.tsx src/components/PlanPanel.test.tsx`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Write ChapterToolbar**

Create `frontend/src/components/ChapterToolbar.tsx`:

```typescript
import { Button } from './ui/button';

interface ChapterToolbarProps {
  busy: boolean;
  onGeneratePlan: () => void;
  onGenerateDraft: () => void;
  onCheck: () => void;
}

export function ChapterToolbar({
  busy,
  onGeneratePlan,
  onGenerateDraft,
  onCheck,
}: ChapterToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-6 py-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={onGeneratePlan}>
        Generate Plan
      </Button>
      <Button size="sm" disabled={busy} onClick={onGenerateDraft}>
        Generate Draft
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onCheck}>
        Check
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Write PlanPanel**

Create `frontend/src/components/PlanPanel.tsx`:

```typescript
import { useState } from 'react';
import type { Issue, ScenePlan } from '../api/types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { IssuesList } from './IssuesList';
import { PlanForm } from './PlanForm';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

interface PlanPanelProps {
  plan: ScenePlan | null;
  issues: Issue[] | null;
  height: number;
  onHeightChange: (px: number) => void;
  onPlanChange: (plan: ScenePlan) => void;
  onIssuesChange: (issues: Issue[]) => void;
  onDrop: () => void;
  onGenerateDraft: () => void;
  onRevise: () => void;
  busy: boolean;
}

export function PlanPanel({
  plan,
  issues,
  height,
  onHeightChange,
  onPlanChange,
  onIssuesChange,
  onDrop,
  onGenerateDraft,
  onRevise,
  busy,
}: PlanPanelProps) {
  const [tab, setTab] = useState<'plan' | 'issues'>('plan');

  // Drag the top edge to resize. Pointer events on window so the drag survives
  // the cursor leaving the 6px handle.
  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startHeight = height;
    const move = (ev: PointerEvent) =>
      onHeightChange(
        Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight - (ev.clientY - startY))),
      );
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const tabButton = (id: 'plan' | 'issues', label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={cn(
        'rounded px-2 py-0.5 text-xs',
        tab === id ? 'bg-white font-medium text-gray-800' : 'text-gray-400 hover:text-gray-600',
      )}
    >
      {label}
    </button>
  );

  return (
    <section
      style={{ height }}
      className="flex flex-shrink-0 flex-col border-t border-gray-300 bg-[#fafaf7]"
    >
      <div
        onPointerDown={startResize}
        className="h-1.5 cursor-ns-resize bg-gray-200 hover:bg-blue-300"
      />

      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-1.5">
        <div className="flex items-center gap-1">
          {tabButton('plan', 'Plan')}
          {tabButton('issues', `Issues${issues?.length ? ` (${issues.length})` : ''}`)}
        </div>
        <div className="flex items-center gap-2">
          {tab === 'plan' ? (
            <>
              <Button size="sm" variant="secondary" onClick={onDrop} disabled={busy}>
                ✕ Drop
              </Button>
              <Button size="sm" onClick={onGenerateDraft} disabled={busy || !plan}>
                Generate Draft →
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy || !issues?.length}
              onClick={() => {
                if (window.confirm('Revise the draft from these issues? This replaces the chapter text.'))
                  onRevise();
              }}
            >
              Revise Draft
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'plan' ? (
          plan ? (
            <PlanForm plan={plan} onChange={onPlanChange} />
          ) : (
            <p className="text-sm text-gray-400">No plan yet — use Generate Plan.</p>
          )
        ) : (
          <IssuesList issues={issues ?? []} onChange={onIssuesChange} />
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Delete the superseded wizard components**

```bash
cd frontend && git rm src/components/ActionRow.tsx src/components/StepBar.tsx \
  src/components/ChapterControls.tsx src/components/SavedView.tsx src/components/DraftEditor.tsx
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ChapterToolbar.test.tsx src/components/PlanPanel.test.tsx`
Expected: PASS — 7 passed

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src/components
git commit -m "feat: chapter toolbar and resizable plan panel"
```

---

### Task 13: Wire the workspace together

**Files:**
- Rewrite: `frontend/src/screens/WorkspaceScreen.tsx`
- Modify: `frontend/src/App.tsx` (add the document route)
- Delete: `frontend/src/screens/StoryBiblePage.tsx`, `frontend/src/components/NavBar.tsx`, `NavBar.test.tsx`, `frontend/src/components/bible/` (all 10 files), `frontend/src/hooks/workflowReducer.ts`, `workflowReducer.test.ts`, `frontend/src/components/ChapterPanel.tsx`
- Test: `frontend/src/screens/WorkspaceScreen.test.tsx`

**Interfaces:**
- Consumes: Tasks 9-12
- Produces: the assembled workspace

- [ ] **Step 1: Add the route**

In `frontend/src/App.tsx`, inside the `RequireAuth` route element:

```typescript
        <Route path="/p/:projectId" element={<WorkspaceScreen />} />
        <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/screens/WorkspaceScreen.test.tsx`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkspaceScreen } from './WorkspaceScreen';
import { AuthProvider } from '../auth/AuthContext';
import { clearToken } from '../auth/token';

const DOCS = [
  { id: 'b', title: 'Story Bible', kind: 'bible', position: 0, updated_at: '2026-01-01' },
  { id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1, updated_at: '2026-01-01' },
];

const DOC_DETAIL = {
  id: 'c1', title: 'Chapter 1', kind: 'chapter', position: 1, updated_at: '2026-01-01',
  body: 'The rain.', brief: 'Mara waits.', plan: null, issues: null,
};

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

function mockApi() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/documents')) return json(DOCS);
    if (url.includes('/documents/c1')) return json(DOC_DETAIL);
    if (url.includes('/documents/b')) return json({ ...DOC_DETAIL, id: 'b', kind: 'bible', title: 'Story Bible', brief: '' });
    return json({ project_id: 'p1', name: 'Novel' });
  });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Routes>
            <Route path="/p/:projectId" element={<WorkspaceScreen />} />
            <Route path="/p/:projectId/d/:documentId" element={<WorkspaceScreen />} />
          </Routes>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearToken();
  vi.restoreAllMocks();
});

describe('WorkspaceScreen', () => {
  it('lists the documents in the sidebar', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByText('Story Bible')).toBeInTheDocument();
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
  });

  it('opens the document from the route', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByDisplayValue('The rain.')).toBeInTheDocument();
  });

  it('shows the generate toolbar on a chapter', async () => {
    mockApi();
    renderAt('/p/p1/d/c1');
    expect(await screen.findByRole('button', { name: /generate plan/i })).toBeInTheDocument();
  });

  it('hides the generate toolbar on the bible', async () => {
    mockApi();
    renderAt('/p/p1/d/b');
    expect(await screen.findByDisplayValue('Story Bible')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate plan/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/screens/WorkspaceScreen.test.tsx`
Expected: FAIL — the current `WorkspaceScreen` renders `NavBar` and `ChapterPanel`.

- [ ] **Step 4: Rewrite WorkspaceScreen**

Replace `frontend/src/screens/WorkspaceScreen.tsx`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  checkDocument,
  draftStreamUrl,
  generatePlan,
  getProject,
  reviseStreamUrl,
  updateDocument,
  type DocumentPatch,
} from '../api/endpoints';
import type { Issue, ScenePlan } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ChapterToolbar } from '../components/ChapterToolbar';
import { DocumentEditor } from '../components/DocumentEditor';
import { DocumentSidebar } from '../components/DocumentSidebar';
import { PlanPanel } from '../components/PlanPanel';
import { Button } from '../components/ui/button';
import { useDraftStream } from '../hooks/useDraftStream';
import {
  documentKey,
  useCreateDocument,
  useDeleteDocument,
  useDocument,
  useDocuments,
  useReorderDocuments,
} from '../hooks/queries';

const COLLAPSE_KEY = 'maya.sidebar.collapsed';
const HEIGHT_KEY = 'maya.panel.height';

export function WorkspaceScreen() {
  const { projectId, documentId } = useParams<{ projectId: string; documentId?: string }>();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [panelHeight, setPanelHeight] = useState(
    () => Number(localStorage.getItem(HEIGHT_KEY)) || 240,
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [streamBody, setStreamBody] = useState<string | undefined>(undefined);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Resolves the flush-before-stream promise chain.
  const pendingSave = useRef<Promise<unknown>>(Promise.resolve());

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });
  const documents = useDocuments(projectId!);
  const document = useDocument(projectId!, documentId);
  const createDoc = useCreateDocument(projectId!);
  const deleteDoc = useDeleteDocument(projectId!);
  const reorderDocs = useReorderDocuments(projectId!);
  const stream = useDraftStream();

  // With no document in the route, open the bible.
  useEffect(() => {
    if (!documentId && documents.data?.length) {
      const first = documents.data.find((d) => d.kind === 'bible') ?? documents.data[0];
      navigate(`/p/${projectId}/d/${first.id}`, { replace: true });
    }
  }, [documentId, documents.data, navigate, projectId]);

  const save = useCallback(
    (patch: DocumentPatch) => {
      if (!documentId) return Promise.resolve();
      setSaveState('saving');
      const promise = updateDocument(projectId!, documentId, patch)
        .then((doc) => {
          qc.setQueryData(documentKey(projectId!, documentId), doc);
          if (patch.title !== undefined) qc.invalidateQueries({ queryKey: ['documents', projectId] });
          setSaveState('saved');
        })
        .catch(() => setSaveState('error'));
      pendingSave.current = promise;
      return promise;
    },
    [documentId, projectId, qc],
  );

  const planMut = useMutation({
    mutationFn: () => generatePlan(projectId!, documentId!),
    onSuccess: (res) => {
      qc.setQueryData(documentKey(projectId!, documentId!), (old: unknown) =>
        old ? { ...(old as object), plan: res.plan } : old,
      );
      setPanelOpen(true);
    },
    onError: (e: Error) => setError(e.message),
  });

  const checkMut = useMutation({
    // Check reads Document.body server-side, so the pending autosave must land first.
    mutationFn: () => pendingSave.current.then(() => checkDocument(projectId!, documentId!)),
    onSuccess: (res) => {
      qc.setQueryData(documentKey(projectId!, documentId!), (old: unknown) =>
        old ? { ...(old as object), issues: res.issues } : old,
      );
      setPanelOpen(true);
    },
    onError: (e: Error) => setError(e.message),
  });

  /** Flush pending autosave, then stream; the server owns `body` for the duration. */
  const runStream = async (url: string, body: unknown) => {
    setError(null);
    await pendingSave.current;
    const base = document.data?.body ?? '';
    setStreamBody(base);
    try {
      await stream.run(url, body, {
        onDelta: (text) => setStreamBody((prev) => (prev ?? '') + text),
        onDone: (full) => {
          qc.setQueryData(documentKey(projectId!, documentId!), (old: unknown) =>
            old ? { ...(old as object), body: full } : old,
          );
          setStreamBody(undefined);
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setStreamBody(undefined);
    }
  };

  const generateDraft = async () => {
    let plan: ScenePlan | null = document.data?.plan ?? null;
    if (!plan) {
      const res = await planMut.mutateAsync();
      plan = res.plan;
    }
    setPanelOpen(true);
    await runStream(draftStreamUrl(projectId!, documentId!), { plan });
  };

  const revise = () => runStream(reviseStreamUrl(projectId!, documentId!), null);

  if (!projectId) return <Navigate to="/" replace />;
  if (project.isError) return <Navigate to="/" replace />;

  const doc = document.data;
  const isChapter = doc?.kind === 'chapter';
  const busy =
    planMut.isPending || checkMut.isPending || stream.isStreaming || deleteDoc.isPending;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f0]">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            ← Projects
          </Button>
          <h1 className="text-base font-semibold text-gray-800">{project.data?.name ?? '…'}</h1>
        </div>
        <Button variant="secondary" size="sm" onClick={logout}>
          Log out
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <DocumentSidebar
          documents={documents.data ?? []}
          activeId={documentId}
          collapsed={collapsed}
          onToggleCollapsed={() => {
            setCollapsed((c) => {
              localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
              return !c;
            });
          }}
          onSelect={(id) => navigate(`/p/${projectId}/d/${id}`)}
          onCreate={() =>
            createDoc.mutate(
              { title: 'Untitled', kind: 'chapter' },
              { onSuccess: (d) => navigate(`/p/${projectId}/d/${d.id}`) },
            )
          }
          onRename={(id, title) => updateDocument(projectId, id, { title }).then(() =>
            qc.invalidateQueries({ queryKey: ['documents', projectId] }),
          )}
          onDelete={(id) =>
            deleteDoc.mutate(id, {
              onSuccess: () => {
                if (id === documentId) navigate(`/p/${projectId}`, { replace: true });
              },
            })
          }
          onReorder={(ids) => reorderDocs.mutate(ids)}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {isChapter && (
            <ChapterToolbar
              busy={busy}
              onGeneratePlan={() => planMut.mutate()}
              onGenerateDraft={generateDraft}
              onCheck={() => checkMut.mutate()}
            />
          )}

          {doc ? (
            <DocumentEditor
              document={doc}
              readOnly={stream.isStreaming}
              onSave={save}
              saveState={saveState}
              bodyOverride={streamBody}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              {documents.isLoading ? 'Loading…' : 'Select a document.'}
            </div>
          )}

          {error && (
            <p className="border-t border-red-200 bg-red-50 px-6 py-1.5 text-xs text-red-700">
              {error}
            </p>
          )}

          {isChapter && panelOpen && (
            <PlanPanel
              plan={doc?.plan ?? null}
              issues={doc?.issues ?? null}
              height={panelHeight}
              onHeightChange={(h) => {
                setPanelHeight(h);
                localStorage.setItem(HEIGHT_KEY, String(h));
              }}
              onPlanChange={(plan: ScenePlan) => save({ plan })}
              onIssuesChange={(issues: Issue[]) => save({ issues })}
              onDrop={() => {
                save({ plan: null });
                qc.setQueryData(documentKey(projectId, documentId!), (old: unknown) =>
                  old ? { ...(old as object), plan: null } : old,
                );
                setPanelOpen(false);
              }}
              onGenerateDraft={generateDraft}
              onRevise={revise}
              busy={busy}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Delete the superseded screens and hooks**

```bash
cd frontend && git rm src/screens/StoryBiblePage.tsx src/components/NavBar.tsx \
  src/components/NavBar.test.tsx src/components/ChapterPanel.tsx \
  src/hooks/workflowReducer.ts src/hooks/workflowReducer.test.ts
git rm -r src/components/bible
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/screens/WorkspaceScreen.test.tsx`
Expected: PASS — 4 passed

- [ ] **Step 7: Commit**

```bash
git add -A frontend/src
git commit -m "feat: assemble the document workspace and drop the chapter wizard"
```

---

### Task 14: Full verification

**Files:**
- Modify: `README.md`, `TODO.md`, `NOTES.md` as needed

- [ ] **Step 1: Typecheck and lint**

```bash
cd frontend && npm run typecheck && npm run lint
```
Expected: clean. Fix any import left dangling by the deletions.

- [ ] **Step 2: Full frontend suite**

```bash
cd frontend && npm test
```
Expected: all pass. Any surviving reference to `bible-types`, `workflowReducer`,
`ChapterPanel`, or `getChapter` is a leftover — delete it.

- [ ] **Step 3: Full backend suite**

```bash
uv run pytest -v
```
Expected: all pass.

- [ ] **Step 4: Migration round-trip on a scratch database**

```bash
rm -f /tmp/maya-verify.db
DATABASE_URL=sqlite+aiosqlite:////tmp/maya-verify.db uv run alembic upgrade head
DATABASE_URL=sqlite+aiosqlite:////tmp/maya-verify.db uv run alembic downgrade 0001
DATABASE_URL=sqlite+aiosqlite:////tmp/maya-verify.db uv run alembic upgrade head
```
Expected: no errors in either direction.

- [ ] **Step 5: Manual smoke test**

```bash
make dev
```

At http://localhost:5173: register, create a project, confirm it opens on a seeded
Story Bible; add a chapter; type a brief and Generate Plan; confirm the panel opens
with fields; Generate Draft and confirm prose streams into the editor and survives a
reload; edit the body and confirm the save indicator; Check and confirm the Issues
tab populates; rename, reorder by dragging, and delete a document; confirm the bible
has no delete control; collapse the sidebar and reload to confirm it stays collapsed.

- [ ] **Step 6: Update the docs**

In `TODO.md`, remove the `save_summary` item — Task 6 implements it — and add:

```markdown
- [ ] **Drop the legacy tables.** Migration 0002 backfills `documents` but leaves
  `chapters`, `draft_states`, `summaries`, `projects.bible_content`, and
  `projects.outline_content` in place as a rollback window. Once the document UI is
  confirmed against the Railway database, add migration 0003 to drop them.
```

In `README.md`, replace the story-bible/outline description in the intro paragraph
with the document model: "Maya keeps a project as a list of documents — a story
bible plus chapters and notes — and runs each chapter through separate agent passes
(planner → drafter → checker), each with a narrow job."

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: update README and TODO for the document workspace"
```

---

## Notes for the implementer

- **The write race is the subtle part.** `WorkspaceScreen.runStream` awaits
  `pendingSave.current` before opening the stream, and `DocumentEditor` takes
  `bodyOverride` during it. Skipping either produces a chapter that loses the
  writer's last few keystrokes, intermittently and only under fast typing.
- **`PUT /order` must be registered before `GET /{document_id}`** in
  `backend/routes/documents.py`, or FastAPI parses `"order"` as a UUID and 422s.
- **The migration is deliberately non-destructive.** Do not add drops to `0002`.
- **`asyncio.gather` in `build_previous_summaries`** shares one `AsyncSession`
  across concurrent calls, but only the `summarize_node` API calls run
  concurrently — the session writes happen after the gather returns. Do not move
  DB work inside the gather; `AsyncSession` is not concurrency-safe.
- **One spec test requirement is covered manually, not automatically.** The spec's
  frontend section asks for a test of "the stream flush-then-suspend sequence and
  adoption of the `done` body". Its two halves are unit-tested — `DocumentEditor`
  covers `readOnly` and `bodyOverride` (Task 11), and the append/replace semantics
  are covered server-side (Task 7) — but the end-to-end flush-then-stream ordering
  needs a mocked ReadableStream through `fetch` in jsdom, which is brittle enough
  to be worth more than it returns. Task 14 Step 5 exercises it by hand instead. If
  it regresses later, that is where to add the automated test.
