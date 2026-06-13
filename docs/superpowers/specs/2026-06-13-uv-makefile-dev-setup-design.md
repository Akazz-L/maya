# UV + Makefile Dev Setup Design

**Date:** 2026-06-13
**Status:** Approved

## Goal

Replace `pip` + `requirements.txt` with UV for Python dependency management, and introduce a Makefile to make running the app (FastAPI backend + Vite frontend) a single-command experience.

## Context

Maya is a FastAPI backend + React/Vite/TypeScript frontend. Dev uses SQLite (zero external services). Currently, developers must run two separate terminal commands manually and install deps via plain pip.

## Scope

- Migrate Python deps from `requirements.txt` to `pyproject.toml` (UV-managed)
- Add `uv.lock` for reproducible installs
- Add a `Makefile` at the project root with standard dev targets
- Remove `requirements.txt`
- Keep `.python-version` (3.12.12) — UV respects it

## UV Setup

`pyproject.toml` declares the project name, Python version constraint, and all 15 existing dependencies from `requirements.txt`. UV manages a `.venv` at the project root (same location as current `.venv`). `uv.lock` is committed for reproducibility.

No changes to backend code — `uv run` uses the managed venv transparently.

## Makefile Targets

| Target | Command | Description |
|---|---|---|
| `make help` | (prints targets) | List all available targets |
| `make install` | `uv sync && cd frontend && npm install` | Install all deps |
| `make dev` | (concurrent) | Start backend + frontend; Ctrl-C kills both |
| `make backend` | `uv run uvicorn backend.main:app --reload --port 8000` | Backend only |
| `make frontend` | `cd frontend && npm run dev` | Frontend only |
| `make test` | `uv run pytest` | Run test suite |
| `make migrate` | `uv run alembic upgrade head` | Run DB migrations |

### `make dev` implementation

Launches both processes in the background, traps SIGINT/SIGTERM, and kills both on Ctrl-C:

```make
dev:
	@trap 'kill 0' SIGINT SIGTERM; \
	uv run uvicorn backend.main:app --reload --port 8000 & \
	(cd frontend && npm run dev) & \
	wait
```

## Files Changed

| File | Action |
|---|---|
| `pyproject.toml` | Create |
| `uv.lock` | Create (generated) |
| `Makefile` | Create |
| `requirements.txt` | Delete |

## Developer Workflow After This Change

```bash
# First-time setup
make install

# Daily dev
make dev        # starts both backend + frontend

# Tests
make test

# DB migration
make migrate
```
