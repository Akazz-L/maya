# UV + Makefile Dev Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pip + requirements.txt with UV for Python dependency management and add a Makefile for one-command dev startup.

**Architecture:** `pyproject.toml` becomes the single source of truth for Python deps (runtime in `[project.dependencies]`, test deps in `[dependency-groups]`). `uv sync` installs everything and generates `uv.lock`. The Makefile wraps both backend and frontend commands, with `make dev` launching both processes concurrently and killing both on Ctrl-C.

**Tech Stack:** UV (Python package manager), GNU Make, existing FastAPI + Vite stack

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `pyproject.toml` | Create | UV project manifest — declares Python version, runtime deps, dev deps |
| `uv.lock` | Generated | Reproducible lockfile — committed to git |
| `Makefile` | Create | Dev workflow commands — install, dev, backend, frontend, test, migrate |
| `requirements.txt` | Delete | Replaced by pyproject.toml |
| `run.md` | Modify | Update instructions to use make commands |

---

## Task 1: Create pyproject.toml

**Files:**
- Create: `pyproject.toml`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "maya"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "anthropic>=0.40.0",
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "pyyaml>=6.0.0",
    "pydantic>=2.0.0",
    "python-dotenv>=1.0.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.29.0",
    "alembic>=1.13.0",
    "bcrypt>=4.0.0",
    "python-jose[cryptography]>=3.3.0",
    "aiosqlite>=0.20.0",
]

[dependency-groups]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
    "pytest-asyncio>=0.23.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

Note: `pytest.ini` config is moved into `pyproject.toml` so it can be deleted later.

- [ ] **Step 2: Run uv sync to install deps and generate lockfile**

```bash
uv sync
```

Expected output ends with something like:
```
Resolved N packages in Xs
Installed N packages in Xs
```

The `.venv/` and `uv.lock` will be created/updated in the project root.

- [ ] **Step 3: Verify Python imports work**

```bash
uv run python -c "import fastapi, anthropic, sqlalchemy, alembic, bcrypt, jose; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add pyproject.toml and uv.lock for UV package management"
```

---

## Task 2: Create Makefile

**Files:**
- Create: `Makefile`

- [ ] **Step 1: Create Makefile**

Create `Makefile` at the project root. **Important:** indented lines under each target must use a real tab character (`\t`), not spaces — Make requires this.

```makefile
.DEFAULT_GOAL := help

.PHONY: help install dev backend frontend test migrate

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (Python + frontend)
	uv sync
	cd frontend && npm install

dev: ## Start backend and frontend together (Ctrl-C stops both)
	@trap 'kill 0' SIGINT SIGTERM; \
	uv run uvicorn backend.main:app --reload --port 8000 & \
	(cd frontend && npm run dev) & \
	wait

backend: ## Start the backend only (port 8000, with reload)
	uv run uvicorn backend.main:app --reload --port 8000

frontend: ## Start the frontend only (port 5173)
	cd frontend && npm run dev

test: ## Run the test suite
	uv run pytest

migrate: ## Run database migrations (alembic upgrade head)
	uv run alembic upgrade head
```

- [ ] **Step 2: Verify make help works**

```bash
make help
```

Expected output (colored in a real terminal):
```
  help          Show available targets
  install       Install all dependencies (Python + frontend)
  dev           Start backend and frontend together (Ctrl-C stops both)
  backend       Start the backend only (port 8000, with reload)
  frontend      Start the frontend only (port 5173)
  test          Run the test suite
  migrate       Run database migrations (alembic upgrade head)
```

- [ ] **Step 3: Verify make test passes**

```bash
make test
```

Expected: all existing tests pass (same result as running `uv run pytest` directly).

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "chore: add Makefile for one-command dev workflow"
```

---

## Task 3: Remove requirements.txt, delete pytest.ini, update run.md

**Files:**
- Delete: `requirements.txt`
- Delete: `pytest.ini` (config moved to pyproject.toml in Task 1)
- Modify: `run.md`

- [ ] **Step 1: Delete requirements.txt and pytest.ini**

```bash
git rm requirements.txt pytest.ini
```

- [ ] **Step 2: Update run.md**

Replace the contents of `run.md` with:

```markdown
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

Opens both the backend (port 8000) and the Vite dev server (port 5173). Ctrl-C stops both.

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
```

- [ ] **Step 3: Verify tests still pass after pytest.ini removal**

`pytest.ini` config was moved to `pyproject.toml` in Task 1. Confirm pytest still picks it up:

```bash
make test
```

Expected: all tests pass (same count as before).

- [ ] **Step 4: Commit**

```bash
git add run.md
git commit -m "chore: remove requirements.txt and pytest.ini, update run.md for UV + make workflow"
```
