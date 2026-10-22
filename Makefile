.DEFAULT_GOAL := help

.PHONY: help install dev backend frontend test migrate seed stripe-listen stripe-listen-if-configured

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
	$(MAKE) --no-print-directory stripe-listen-if-configured & \
	wait

backend: migrate ## Start the backend only (port 8000, with reload)
	uv run uvicorn backend.main:app --reload --port 8000

frontend: ## Start the frontend only (port 5173)
	cd frontend && npm run dev

test: ## Run the test suite
	uv run pytest

migrate: ## Run database migrations (alembic upgrade head)
	uv run alembic upgrade head

seed: migrate ## Create the demo account and its sample novel (safe to re-run)
	uv run python scripts/seed_demo.py

STRIPE_EVENTS := customer.subscription.created,customer.subscription.updated,customer.subscription.deleted

stripe-listen: ## Forward Stripe webhooks to the local backend (needs the Stripe CLI)
	stripe listen --forward-to localhost:8000/billing/webhook --events $(STRIPE_EVENTS)

# Part of `make dev`: billing is optional, so skip quietly when it is not set up.
stripe-listen-if-configured:
	@key=$$(sed -n 's/^STRIPE_SECRET_KEY=//p' .env 2>/dev/null); \
	if [ -z "$$key" ]; then echo "stripe listen skipped: STRIPE_SECRET_KEY is not set (billing off)"; \
	elif ! command -v stripe >/dev/null; then echo "stripe listen skipped: Stripe CLI not installed"; \
	else exec stripe listen --api-key "$$key" --forward-to localhost:8000/billing/webhook --events $(STRIPE_EVENTS); fi
