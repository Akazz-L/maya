.DEFAULT_GOAL := help

.PHONY: help install dev backend frontend test migrate

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies (Python + frontend)
	uv sync
	cd frontend && npm install

# dev/backend depend on migrate so a fresh clone still starts with zero setup
# now that Alembic (not create_all) owns the schema.
dev: migrate ## Start backend and frontend together (Ctrl-C stops both)
	@trap 'kill 0' SIGINT SIGTERM; \
	uv run uvicorn backend.main:app --reload --port 8000 & \
	(cd frontend && npm run dev) & \
	wait

backend: migrate ## Start the backend only (port 8000, with reload)
	uv run uvicorn backend.main:app --reload --port 8000

frontend: ## Start the frontend only (port 5173)
	cd frontend && npm run dev

test: ## Run the test suite
	uv run pytest

migrate: ## Run database migrations (alembic upgrade head)
	uv run alembic upgrade head
