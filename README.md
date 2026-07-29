# Maya

An iterative, chapter-by-chapter novel-writing assistant. Instead of generating a
book in one shot, Maya keeps persistent state — a story bible, an outline, and
previous-chapter summaries — and runs each chapter through separate agent passes
(planner → drafter → checker), each with a narrow job.

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
| `make help` | List all targets |

## Notes

- Alembic owns the schema. `make dev` and `make backend` run `make migrate` first,
  so a fresh clone starts with no manual setup.
- To use PostgreSQL instead of SQLite, set
  `DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/maya` in `.env`, then
  run `make migrate`. Bare `postgres://` / `postgresql://` URLs (as Railway, Heroku,
  and Fly hand out) are rewritten to the asyncpg driver automatically.
- `run.md` covers the same ground in more detail.
