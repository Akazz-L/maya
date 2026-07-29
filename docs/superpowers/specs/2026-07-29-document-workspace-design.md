# Document Workspace — Design Spec
**Date:** 2026-07-29

## Overview

Replace Maya's chapter wizard with a document-based workspace that matches how a
novelist actually works: a collapsible left sidebar listing free-text documents,
any of which the writer can add, rename, reorder, or delete. Every project has one
pinned Story Bible document. Chapter documents carry two generation actions —
Generate Plan and Generate Draft — with the plan appearing in a resizable panel
below the prose, where it can be edited, dropped, or turned into a draft.

Two structural constraints in the current app are the real targets:

1. **Chapters cannot exist outside the outline.** `_base_state` (`backend/main.py:169`)
   resolves a chapter's planner input by indexing `outline.chapters[n - 1]` and
   raises `400 Chapter {n} not in outline` otherwise. A writer cannot add a chapter
   without first editing an outline list.
2. **Only one thing is visible at a time.** `ChapterPanel` swaps a single pane
   through `plan → draft → check → saved` via `workflowReducer`, so the plan is
   invisible while writing the prose it describes.

---

## 1. Data model

A new `documents` table supersedes `projects.bible_content`, `projects.outline_content`,
and the `chapters`, `draft_states`, and `summaries` tables.

```python
class Document(Base):
    __tablename__ = "documents"

    id:           Mapped[uuid.UUID]     # pk
    project_id:   Mapped[uuid.UUID]     # fk → projects.id, ondelete=CASCADE, indexed
    title:        Mapped[str]           # String(255)
    kind:         Mapped[str]           # String(16): 'bible' | 'chapter' | 'note'
    body:         Mapped[str]           # Text, default ''  — the free text field
    brief:        Mapped[str]           # Text, default ''  — chapter only; the planner's outline_beat
    plan:         Mapped[dict | None]   # JSON — last generated/edited scene plan
    issues:       Mapped[list | None]   # JSON — last continuity check result
    summary:      Mapped[str | None]    # Text — cached summary, for prior-chapter context
    summary_hash: Mapped[str | None]    # String(64) — sha256(body) when summary was generated
    position:     Mapped[int]           # sidebar sort order, 0-based
    created_at:   Mapped[datetime]
    updated_at:   Mapped[datetime]
```

### Field notes

- **`kind`** determines behavior. `bible` is pinned to the top of the sidebar and
  cannot be deleted. `chapter` documents get the generation toolbar and feed
  prior-chapter context. `note` documents are pure scratch text — no toolbar, and
  they are never sent to an agent.
- **`brief`** replaces the outline-index lookup. It holds the one- or two-sentence
  "what happens in this chapter" that becomes the planner's `outline_beat`. Because
  it lives on the document, a chapter can be created at any position without an
  outline existing at all.
- **`position`** is an integer, and a reorder renumbers every document in the project
  in one batch. Document counts are in the tens; fractional-gap ordering is not worth
  the precision drift.
- **`summary` / `summary_hash`** are the prior-chapter cache. A cached summary is
  reused when `sha256(body.encode()).hexdigest() == summary_hash`; any edit to the
  body invalidates it.

### Constraints

- At most one `bible` document per project, enforced by a partial unique index on
  `project_id` where `kind = 'bible'`. Both SQLite and PostgreSQL support partial
  indexes, so the same `Index(..., unique=True, sqlite_where=..., postgresql_where=...)`
  declaration covers local dev and the Railway deployment.
- `DELETE` on a `bible` document returns `409`.
- `kind` is validated against the three permitted values on write.

### Project bootstrap

`POST /projects` creates the project *and* its Story Bible document in the same
transaction: `kind='bible'`, `title='Story Bible'`, `position=0`, and a `body`
seeded with the four conventional headings so the writer has somewhere to start:

```markdown
## Characters

## World

## Style

## Timeline
```

No chapter documents are created. A new project opens on its Story Bible.

---

## 2. Migration

**Migration `0002_documents`** creates the `documents` table and backfills it from
existing data. For each project:

1. Render `bible_content` JSON to markdown as the `bible` document at `position=0`,
   under the four headings above — characters as `### {name}` with traits and
   dialogue examples as bullets, world locations and rules as bullets, style voice
   as prose with avoid-items as bullets, timeline as bullets. A project whose
   `bible_content` is empty or unparseable gets the seed template instead.
2. Convert each row in `chapters` to a `chapter` document, ordered by `number`:
   `title = f"Chapter {number}"`, `body = draft or ''`, `plan = plan`,
   `issues = issues`, and `brief` taken from `outline_content.chapters[number - 1]`
   when that index exists, otherwise `''`.
3. Append any outline beats with no corresponding chapter row as empty chapter
   documents, so an outlined-but-unwritten chapter still appears in the sidebar.
4. Carry over `summaries.text` into `Document.summary`, leaving `summary_hash`
   `NULL` so the first generation re-summarizes against the real body.

`draft_states` rows are **not** migrated. They represent an in-flight wizard step,
a concept the new UI does not have; their `draft` content is already reflected in
the chapter row or was never accepted.

**The legacy tables are left in place.** `chapters`, `draft_states`, `summaries`,
`projects.bible_content`, and `projects.outline_content` survive migration `0002`
untouched and unread by the application. Dropping them is a separate follow-up
migration, applied deliberately once the new UI is confirmed working against the
deployed database. `make dev` and `make backend` run `alembic upgrade head` on every
start, so a destructive drop bundled into this change would run automatically and
irreversibly.

A test seeds the pre-migration schema with a project, a structured bible, three
chapters, and an outline, runs the migration, and asserts the resulting documents.

---

## 3. Agents

All three agents currently consume a structured bible via `yaml.dump` of individual
keys. They now receive the bible as a single markdown string.

| Agent | Current bible use | Becomes |
|---|---|---|
| `planner_node` | `yaml.dump` of `characters`, `world`, `timeline` | `story_bible: str` interpolated as one block |
| `drafter_node` (`_build_messages`) | `style_guide.voice`, `style_guide.avoid`, per-character `dialogue_examples` loop | same block; voice, avoid-list, and dialogue examples are read out of the text by the model |
| `checker_node` | `yaml.dump` of `characters`, `world`, `timeline`, `style_guide` | same block |

The `dialogue_blocks` construction and `avoid_lines` join in `_build_messages` are
removed. The drafter's revision branch (`is_revision`, driven by a non-empty draft
plus issues) is unchanged and still powers the revise-from-issues flow.

**New: `backend/agents/summarizer.py`**

```python
async def summarize_node(text: str) -> str
```

Returns a compact prose summary of a chapter body, emphasizing plot events,
character knowledge changes, and physical/temporal facts — the material the checker
needs for continuity. Called only for chapter documents with a non-empty body.

### Prior-chapter context

`previous_summaries` is currently always `[]`, because `save_summary()` is never
called anywhere in the application (recorded in `TODO.md`). This design makes it work.

On Generate Plan, Generate Draft, or Check for document *D*:

1. Select `kind='chapter'` documents in the project with `position < D.position`
   and a non-empty `body`, ordered by `position`.
2. Take the **10 most recent** of those (the ones nearest *D*). Without this cap,
   the first generation on chapter 30 fires 29 model calls.
3. For each, reuse `summary` when `summary_hash` matches the current body hash;
   otherwise call `summarize_node`.
4. Run the cache misses **concurrently** with `asyncio.gather`, then persist each
   new `summary` and `summary_hash`.
5. Pass the summaries to the agent in position order.

---

## 4. API

`backend/main.py` is 466 lines covering auth, projects, bible, outline, chapter
workflow, SSE, and SPA serving. The bible, outline, and chapter-workflow routes are
deleted by this change, so their replacements go into two new modules rather than
back into `main.py`:

- `backend/routes/documents.py` — document CRUD and ordering
- `backend/routes/generate.py` — plan, draft stream, check

`main.py` retains auth, projects, health, and SPA serving at roughly 200 lines.
`backend/storage.py` (90 lines) is deleted — nothing imports it.

### Document routes

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/projects/{pid}/documents` | — | `[{id, title, kind, position, updated_at}]`, no bodies |
| `POST` | `/projects/{pid}/documents` | `{title?, kind?}` | full document |
| `GET` | `/projects/{pid}/documents/{did}` | — | full document |
| `PATCH` | `/projects/{pid}/documents/{did}` | `{title?, body?, brief?, plan?, issues?, kind?}` | full document |
| `DELETE` | `/projects/{pid}/documents/{did}` | — | `204`, or `409` for `kind='bible'` |
| `PUT` | `/projects/{pid}/documents/order` | `{document_ids: [...]}` | `204` |

`POST` defaults to `kind='chapter'`, `title='Untitled'`, and `position` at the end
of the list. `PUT .../order` renumbers positions to match the given sequence and
rejects a list that does not contain exactly the project's document ids. `DELETE`
renumbers the remaining documents to close the gap, so positions stay contiguous.

Every route resolves the document by `(project_id, document_id)` and reuses the
existing `_require_project` ownership check, so a document id from another user's
project returns `404`.

### Generation routes

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/projects/{pid}/documents/{did}/plan` | — | `{plan}` |
| `POST` | `/projects/{pid}/documents/{did}/draft/stream` | `{plan}` | SSE: `delta`, `done`, `error` |
| `POST` | `/projects/{pid}/documents/{did}/check` | — | `{issues}` |
| `POST` | `/projects/{pid}/documents/{did}/revise/stream` | — | SSE: `delta`, `done`, `error` |

All four return `400` when the target document's `kind` is not `chapter`.

`revise/stream` is what makes Check actionable: it feeds `Document.body` and
`Document.issues` to the drafter's existing revision branch (`is_revision` in
`_build_messages`), which would otherwise be unreachable. Unlike draft, **revise
replaces `body` wholesale** rather than appending — it returns a revision of the
whole text, not a continuation — so the UI puts it behind a confirm and offers it
from the Issues tab only when issues are present.

`plan` persists the result to `Document.plan`. `draft/stream` persists the plan it
receives in the request body to `Document.plan` before generating, so an edit made
in the panel is saved even if the stream then fails. `check` reads the draft from
`Document.body` and the plan from `Document.plan`, and persists to `Document.issues`;
the client flushes its pending autosave before calling it, for the same reason as the
draft stream. The existing SSE framing (`_sse`, `_SSE_HEADERS`) is reused unchanged.

`GET /projects/{pid}` currently returns `bible_content` and `outline_content`. Both
become stale the moment migration `0002` runs, so they are dropped from the response,
along with the matching fields on the `ProjectDetail` type and the `bible_content` /
`outline_content` arguments to `POST /projects`.

### Draft streaming and the write race

The editor autosaves `body` on a debounce while the server also needs to append the
finished draft to `body`. Two writers on one field. The protocol:

1. The client **flushes any pending autosave** and waits for it to complete before
   opening the stream.
2. The client suspends autosave and sets the editor read-only for the duration.
3. Deltas render into the editor as they arrive, appended after the existing text.
4. On completion the **server** sets `body = existing_body + "\n\n" + draft` (or just
   `draft` when the body was empty), commits, and emits
   `{"type": "done", "body": <full new body>}`.
5. The client adopts the `body` from the `done` event verbatim and re-enables editing.

Server-side persistence means a tab closed mid-generation does not lose the chapter.
The flush-first step means the server appends to a body that already includes the
writer's most recent keystrokes. On `error`, the client re-enables editing and keeps
whatever deltas arrived, without persisting them.

---

## 5. Frontend

### Routing

```
/p/:projectId                  → workspace, redirects to the bible document
/p/:projectId/d/:documentId    → workspace with that document open
```

The open document survives a reload and is linkable.

### Layout

```
┌─────────┬────────────────────────────────┐
│ Docs  ▾ │ Chapter 3  [Plan][Draft][Check]│
│         ├────────────────────────────────┤
│ ⊙ Bible │                                │
│ ──────  │  The rain had not stopped      │
│ • Ch. 1 │  since Tuesday. Mara counted   │
│ • Ch. 2 │  the drops against the glass…  │
│ ▸ Ch. 3 │                                │
│ • Notes │                                │
│         ├═══════════ drag ═══════════════┤
│         │ Plan | Issues          ✕ Drop  │
│         │ Goal    [Mara learns…]         │
│         │ POV     [Mara]                 │
│         │ Beats   1. …  2. …             │
│         │         [Generate Draft →]     │
└─────────┴────────────────────────────────┘
```

### Components

**`DocumentSidebar`** — collapsible, with the collapsed flag persisted to
`localStorage` per project. The Story Bible is pinned at the top above a divider;
chapters and notes follow in `position` order, each with a `kind` marker. Actions:
`+ New` (creates a chapter and opens it with the title in rename mode), double-click
to rename inline, hover-✕ to delete behind a confirm, and drag to reorder. Collapsed,
it shows icons only.

**`DocumentEditor`** — a title input and a `<textarea>` for `body`, with a debounced
`PATCH` at 800ms (matching the cadence `StoryBiblePage` already uses) and a save
indicator. Serif face, generous line height, and a capped measure for prose
readability. Chapter documents additionally show the `brief` as a single-line field
under the title.

**`ChapterToolbar`** — Generate Plan, Generate Draft, and Check, rendered only when
`kind === 'chapter'`.

**`PlanPanel`** — a bottom drawer, resizable by dragging its top edge and collapsible,
with `Plan | Issues` tabs. The Plan tab hosts the existing `PlanForm` plus `✕ Drop`
(clears `Document.plan` and closes the panel) and `Generate Draft →`. The Issues tab
hosts the existing `IssuesList`. Panel height persists to `localStorage`.

### Generate Draft with no plan

Generate Draft on a document with no plan calls `POST .../plan` first, opens the
panel with the result, then chains straight into `POST .../draft/stream` without
waiting for confirmation — one click from brief to prose. With a plan already
present it skips to the stream, using whatever is currently in the panel. Generate
Plan remains the way to get a plan you review before drafting. If this proves wrong
in use, the alternative is disabling Generate Draft until a plan exists, which is
more predictable but makes the two buttons strictly sequential.

### Reused unchanged

`PlanForm`, `IssuesList`, `IssueCard`, `components/ui/*`, `api/stream.ts`,
`hooks/useDraftStream.ts`, `api/client.ts`, `auth/*`, `ProjectsScreen`, `AuthScreen`,
`RequireAuth`.

### Deleted

`hooks/workflowReducer.ts` and its test — its `plan → draft → check → saved` state
machine is precisely the rigidity being removed. Also `ChapterPanel`,
`ChapterControls`, `StepBar`, `ActionRow`, `SavedView`, `DraftEditor`, `NavBar`,
`StoryBiblePage`, `components/bible/*`, `api/bible-types.ts`, and their tests.

Document state is served by TanStack Query (already a dependency, already used by
`hooks/queries.ts`). Only panel height, panel tab, and sidebar collapse are local
component state. `hooks/queries.ts` currently exports `useBible`, `useOutline`,
`useSaveBible`, and `useSaveOutline` against endpoints this change deletes; it is
rewritten to expose document list, document detail, and mutation hooks. The bible
and outline wrappers in `api/endpoints.ts` are replaced by the document routes.

---

## 6. Testing

**Backend (pytest).** Document CRUD; bible uniqueness on project creation; `409` on
bible delete; `400` on invalid `kind`; reorder renumbering and rejection of a
mismatched id list; cross-project document access returning `404`; migration backfill
against a seeded pre-migration database; summary cache hit and miss including
invalidation after a body edit; the concurrent-summarize cap at 10; plan/draft/check
sourcing `brief` and bible text from documents; `400` when generating on a note.

`tests/test_api.py`, `tests/test_storage.py`, `tests/test_planner.py`,
`tests/test_drafter.py`, and `tests/test_checker.py` assert the old structured-bible
and chapter-number shapes throughout and are rewritten against the new ones.

**Frontend (vitest).** Sidebar add, rename, delete-with-confirm, reorder, and
bible-pinning; editor autosave debounce and save indicator; plan panel open, edit,
and drop; toolbar visibility keyed to `kind`; the stream flush-then-suspend sequence
and adoption of the `done` body.

---

## 7. Out of scope

- Dropping the legacy `chapters`, `draft_states`, and `summaries` tables and the two
  `projects` columns. Deliberate follow-up migration, after the new UI is verified
  against the deployed database.
- Rich-text or markdown-preview editing. Documents are plain `<textarea>` text.
- Full-text search across documents.
- Folders or nesting in the sidebar. The list is flat.
- Multi-document or whole-manuscript export.
