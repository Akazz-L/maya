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
and the meter beside it shows what they have spent against their plan's budget.
Generation is refused once the budget is reached, and the meter offers an upgrade.

FastAPI + SQLAlchemy backend, React + Vite frontend.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Node.js (any recent LTS)

## Setup

```bash
cp .env.example .env      # then fill in the three required values
make install              # uv sync + npm install
```

`.env` needs:

- `ANTHROPIC_API_KEY` — the app boots without it, but every generation call fails at request time.
- `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` — from the API Keys page of a [Clerk](https://clerk.com) application.
  Clerk handles sign-up, sign-in and sessions; the backend verifies Clerk's session tokens and creates a writer's row on their first request.
  A free development instance is enough for local work.
  In production, also set `CLERK_AUTHORIZED_PARTIES` to the public URL the app is served from.

`MONTHLY_BUDGET_USD` is optional and defaults to `5.00`. It is the Free plan's AI budget per calendar month (UTC).
Paid plans are optional too; see [Plans and billing](#plans-and-billing).

`DATABASE_URL` is optional; unset, the app uses an on-disk SQLite file (`./maya.db`)
that persists across restarts. No database setup needed for local dev.

## Running in development

```bash
make dev
```

Then open **http://localhost:5173**.

This applies migrations, then starts the backend on `:8000` (with `--reload`) and
the Vite dev server on `:5173`. Ctrl-C stops both.

Both servers need to be up: Vite proxies `/me`, `/agents`, `/billing`, `/projects`, and `/static` to the
backend, so `:5173` is the URL you want — `:8000` serves the API but not the dev UI.

To run just one side: `make backend` or `make frontend`.

## Demo data

```bash
make seed
```

Creates a demo account in Clerk — **demo+clerk_test@example.com** / **salt-road-weighing-house** — owning one project,
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
Clerk checks the password, and refuses one that is too short or found in a known breach.
The `+clerk_test` address is a Clerk test address: on a development instance, any email code Clerk asks for when signing in to it is `424242`.

Seeding needs `CLERK_SECRET_KEY`, since the account lives in Clerk.
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
The meter sums the current budget period: the calendar month in UTC on Free, the Stripe billing period on a paid plan.

Enforcement is pre-flight: a generation is refused with a `402` once the period's
spend reaches the budget, but a call already running always finishes.
A writer therefore never loses a draft mid-stream.
The check reserves nothing, and a call's cost is recorded only when it finishes, so every request that starts under the cap goes through.
Overshoot is bounded by how many requests a writer has in flight at once, not by a single call.

To raise one writer's cap without moving everyone's, find their user id (`user_...`) in the Clerk dashboard, then:

```sql
UPDATE users SET monthly_budget_micro_usd = 20000000 WHERE clerk_user_id = 'user_...';
```

The column is in micro-dollars — the same unit the ledger counts in, so a cap and a
running total compare without any float in the path.
`NULL` means "use the plan's budget"; a value overrides it whatever the plan.

## Plans and billing

| Plan | Price | AI budget per period (default) |
|---|---|---|
| Free | $0 | `MONTHLY_BUDGET_USD`, $5 |
| Starter | $20 / month | `PLAN_STARTER_BUDGET_USD`, $10 |
| Pro | $50 / month | `PLAN_PRO_BUDGET_USD`, $25 |
| Studio | $100 / month | `PLAN_STUDIO_BUDGET_USD`, $50 |

Every plan has every feature and every model; plans differ only in budget.
Each budget is its own setting, not the price, so the margin can be tuned without a deploy.

Paid plans go through Stripe and are off until `STRIPE_SECRET_KEY` is set; without it every writer is on Free.
To turn them on in Stripe (test mode first):

1. Create a product per plan, each with one recurring monthly price, and put the price ids in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_STUDIO`.
2. In the Customer Portal settings, allow switching between those three prices and cancelling at the end of the period.
3. Point a webhook at `/billing/webhook` for the `customer.subscription.created`, `.updated` and `.deleted` events, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   Locally: `stripe listen --forward-to localhost:8000/billing/webhook`.

A writer upgrades from **Plan & billing** in the account menu, which opens Stripe Checkout.
A subscriber changes plan, updates their card or cancels in Stripe's billing portal from the same page.

Stripe is the source of truth.
Every webhook, and the return from checkout, re-reads the customer's subscriptions from Stripe rather than applying the event, so late or out-of-order events cannot leave a writer on the wrong plan.
A subscription pays for its plan while Stripe reports it `active` or `trialing`:

- A cancelled plan keeps its budget until the period it was paid for ends, then drops to Free.
- A failed renewal (`past_due`) drops to Free at once. The payment that failed was for the period just starting, so the paid period has already ended.
  A later successful retry restores the plan.
