# Maya

An iterative, chapter-by-chapter novel-writing assistant.
Instead of generating a book in one shot, Maya keeps a project as a list of documents — a story bible plus chapters and notes — and works on each chapter with agents that each have a narrow job: an optional planner, a chat assistant that drafts and edits, and specialist review passes the chat can call on.

Documents are plain text with a name, added and reordered freely from a sidebar.
Every project has one pinned Story Bible.
Chapter documents carry optional chapter context — an outline, a line of intent, or nothing at all — and a Write / Plan switcher.
The context is editable from both views, and every AI call reads it.
Plan opens the scene plan: empty and ready to type on a chapter without one, or generated on request, with no notes needed.
Edit the plan, regenerate or remove it (with undo), or draft from it.
Prior chapters are summarized automatically and fed back in as context.

Beside each chapter is a chat that does the drafting.
Ask it for a first draft, a draft from the saved scene plan (the Plan view's Draft from plan → sends exactly that), a continuation, or changes to what is already written.
Planning is optional: a chapter can go straight from a prompt to a draft.
Every change the chat makes arrives as a proposal in the editor, streamed in place and shown as a diff you accept or discard.
Targeted changes arrive as a set of separate fixes, each drawn where it applies with one line on what is wrong, each taken or left on its own.
The conversation is kept per chapter, and the assistant is told which fixes you took.

The `+` beside the chat box runs a specialist pass over the chapter.
**Continuity check** reads the chapter against the story bible, the scene plan, and the previous chapters' summaries, and answers with localized fixes rather than a list of findings to act on yourself: the contradiction is marked in the prose, the correction is shown as a diff, and a card beside it says what contradicts what.
Adding another specialist is a prompt and a registry entry in `backend/agents/reviewers.py`; the picker is served from that registry.

Inside a chapter, select any passage and press ⌘K (or click the Rewrite pill) to ask
for a targeted rewrite; the suggestion streams in place and shows as a diff you can
accept or discard.

Each writer picks their own model — Haiku, Sonnet, or Opus — from the editor header,
and the meter beside it shows what they have spent against this month's budget.
Generation is refused once the budget is reached.

FastAPI + SQLAlchemy backend, React + Vite frontend.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Node.js (any recent LTS)

## Setup

```bash
cp .env.example .env      # then fill in the two required values
make install              # uv sync + npm install
```

`.env` needs:

- `ANTHROPIC_API_KEY` — the app boots without it, but every generation call fails at request time.
- `JWT_SECRET` — generate with `openssl rand -hex 32`. Changing it invalidates existing sessions.

`MONTHLY_BUDGET_USD` is optional and defaults to `5.00`. It is the AI budget each
writer gets per calendar month (UTC).

`DATABASE_URL` is optional; unset, the app uses an on-disk SQLite file (`./maya.db`)
that persists across restarts. No database setup needed for local dev.

## Running in development

```bash
make dev
```

Then open **http://localhost:5173**.

This applies migrations, then starts the backend on `:8000` (with `--reload`) and
the Vite dev server on `:5173`. Ctrl-C stops both.

Both servers need to be up: Vite proxies `/auth`, `/projects`, and `/static` to the
backend, so `:5173` is the URL you want — `:8000` serves the API but not the dev UI.

To run just one side: `make backend` or `make frontend`.

## Demo data

```bash
make seed
```

Creates a demo account — **demo@maya.local** / **demo1234** — owning one project,
`Demo — The Salt Road`, whose documents are each left in a different state so
every toolbar action has something to act on:

| Document | State | What it exercises |
|---|---|---|
| Story Bible | Filled in, not the empty template | Context for every agent |
| Chapter 1 | Prose plus a pre-cached summary | **Continuity check** from the chat's `+`, and prior-chapter context |
| Chapter 2 | Scene plan saved, body empty | **Draft from plan →** in the Plan view, which drafts through the chat |
| Chapter 3 | Context only | **Plan**, written by hand or generated, or a draft straight from a chat prompt |
| Research note | Scratch notes | Notes are excluded from all agent context |

Chapter 1's summary is seeded already hashed, so drafting a later chapter costs
no summarizer call.
Re-running replaces the demo project and resets the demo password, leaving any
other project on the account untouched.
Pass `--email`, `--password`, or `--project` to `scripts/seed_demo.py` to seed a
different account.

Generation itself still needs `ANTHROPIC_API_KEY` in `.env`; seeding does not.

## Tests

```bash
make test                     # backend (pytest)
cd frontend && npm test       # frontend (vitest)
```

Frontend extras: `npm run test:watch`, `npm run typecheck`, `npm run lint`,
`npm run format`.

## Make targets

| Command | Description |
|---|---|
| `make dev` | Backend + frontend together |
| `make backend` | Backend only, port 8000 |
| `make frontend` | Vite dev server only, port 5173 |
| `make install` | Install Python + frontend dependencies |
| `make test` | Backend test suite |
| `make migrate` | `alembic upgrade head` |
| `make seed` | Demo account + sample novel (safe to re-run) |
| `make help` | List all targets |

## Diagrams

[`docs/diagrams/`](docs/diagrams/) holds mermaid diagrams of the architecture — the
container view, the database schema, the agent workflows, and the frontend's
component tree and data flows.
They render directly on GitHub and in most editors.

## Notes

- Alembic owns the schema. `make dev` and `make backend` run `make migrate` first,
  so a fresh clone starts with no manual setup.
- To use PostgreSQL instead of SQLite, set
  `DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/maya` in `.env`, then
  run `make migrate`. Bare `postgres://` / `postgresql://` URLs (as Railway, Heroku,
  and Fly hand out) are rewritten to the asyncpg driver automatically.
- `run.md` covers the same ground in more detail.

## Model choice and the AI budget

The model is per user, chosen from the picker in the editor header and applied to every AI call — plan, chat, review, rewrite, and the chapter summaries that run implicitly before each of those.
A change takes effect on the next call; anything already streaming keeps the model
it started on.

Every call's tokens are priced at that model's rates and written to `usage_events`.
The cost is frozen at write time, so changing the price table never rewrites what
someone has already spent.
The meter sums the current calendar month in UTC.

Enforcement is pre-flight: a generation is refused with a `402` once the month's
spend reaches the budget, but a call already running always finishes.
A writer therefore never loses a draft mid-stream.
The check reserves nothing, and a call's cost is recorded only when it finishes, so every request that starts under the cap goes through.
Overshoot is bounded by how many requests a writer has in flight at once, not by a single call.

To raise one writer's cap without moving everyone's:

```sql
UPDATE users SET monthly_budget_micro_usd = 20000000 WHERE email = 'them@example.com';
```

The column is in micro-dollars — the same unit the ledger counts in, so a cap and a
running total compare without any float in the path.
`NULL` means "use `MONTHLY_BUDGET_USD`".
