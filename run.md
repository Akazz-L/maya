# Running Maya locally

## Prerequisites

- [UV](https://docs.astral.sh/uv/getting-started/installation/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Node.js (any recent LTS)

## First-time setup

### 1. Create your `.env` file

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `ANTHROPIC_API_KEY` — your Anthropic API key
- `JWT_SECRET` — any random 32-byte hex string (e.g. `openssl rand -hex 32`)

### 2. Install all dependencies

```bash
make install
```

This runs `uv sync` (Python deps) and `npm install` (frontend deps).

## Running the app

```bash
make dev
```

Starts both the backend (port 8000) and the Vite dev server (port 5173). Ctrl-C stops both.

Open **http://localhost:5173** in your browser.

## Other commands

| Command | Description |
|---|---|
| `make backend` | Backend only |
| `make frontend` | Frontend only |
| `make test` | Run test suite |
| `make migrate` | Run DB migrations |
| `make help` | List all commands |

## Notes

- The Vite dev server proxies `/auth`, `/projects`, and `/static` to the backend on `:8000` — both servers must be running.
- SQLite is used by default. No database setup needed.
- To use PostgreSQL instead, set `DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/maya` in `.env`, then run `make migrate`.
