# syntax=docker/dockerfile:1

# Nixpacks could not build this repo reliably: it detects pyproject.toml at the
# root and runs the Python provider only, so adding the frontend build required
# a custom nixpacks.toml — which in turn dropped the provider's own build
# variables (NIXPACKS_UV_VERSION), breaking `pip install uv==`. A Dockerfile
# expresses both languages directly with no plan merging involved.

# --- Stage 1: build the SPA -------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /app/frontend

# Manifests first, so npm ci stays cached until dependencies actually change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# --- Stage 2: runtime -------------------------------------------------------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH

# Pinned to the version that generated uv.lock, so --frozen stays reproducible.
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv

WORKDIR /app

# Dependency layer, isolated from application source so that editing backend
# code does not reinstall the whole dependency tree on every deploy.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

# backend/main.py resolves the SPA at ../frontend/dist relative to itself, so
# the built assets have to land at exactly this path.
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8000

# Railway injects $PORT; the fallback keeps `docker run` usable locally.
CMD ["sh", "-c", "alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
