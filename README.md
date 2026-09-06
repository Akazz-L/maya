# Maya

An iterative, chapter-by-chapter novel-writing assistant. Instead of generating a
book in one shot, Maya keeps a project as a list of documents — a story bible plus
chapters and notes — and runs each chapter through separate agent passes
(planner → drafter → checker), each with a narrow job.

Documents are plain text with a name, added and reordered freely from a sidebar.
Every project has one pinned Story Bible. Chapter documents carry a short brief
("what happens in this chapter") and get Generate Plan, Generate Draft, and Check
actions, with the scene plan and any continuity issues in a resizable panel below
the prose. Prior chapters are summarized automatically and fed back in as context.

Inside a chapter, select any passage and press ⌘K (or click the Rewrite pill) to ask
for a targeted rewrite; the suggestion streams in place and shows as a diff you can
accept or discard.

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
| Chapter 1 | Prose plus a pre-cached summary | **Check**, and prior-chapter context |
| Chapter 2 | Scene plan saved, body empty | **Generate Draft** from an existing plan |
| Chapter 3 | Brief only | **Generate Plan**, then the plan-to-draft path |
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
