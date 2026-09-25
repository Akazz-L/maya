# System overview

Maya is one FastAPI process, one React single-page app, one SQL database, and two external services: the Anthropic API, and Clerk for accounts and sessions.
There is no queue, no cache server, and no background worker: every generation happens inside the HTTP request that asked for it.

```mermaid
graph TB
    subgraph browser["Browser"]
        SPA["React SPA<br/>React Router · React Query<br/>frontend/src"]
    end

    subgraph server["FastAPI process — backend/"]
        MAIN["main.py<br/>/me · /agents · /projects<br/>/health · SPA catch-all"]
        DOCS["routes/documents.py<br/>/projects/{pid}/documents/*"]
        GEN["routes/generate.py<br/>/plan · /rewrite/stream"]
        CHAT["routes/chat.py<br/>/chat · /chat/stream<br/>/chat/messages/{id}/outcome"]
        DEPS["routes/deps.py + auth.py<br/>Clerk session token → require_project"]
        STORE["doc_storage.py<br/>document CRUD, ordering"]
        CSTORE["chat_storage.py<br/>chat messages, proposals"]
        CTX["context.py<br/>prior-chapter summaries"]
        AGENTS["agents/<br/>planner · chat · rewriter<br/>reviewers · summarizer"]
        DB["db.py<br/>async engine + session"]
    end

    ANTHROPIC["Anthropic API<br/>model chosen per writer, backend/llm.py"]
    SQL[("SQLite ./maya.db<br/>or PostgreSQL via DATABASE_URL")]
    CLERK["Clerk<br/>sign-up · sign-in · sessions"]

    SPA -->|"sign in, getToken()"| CLERK
    SPA -->|"fetch, Bearer Clerk session token"| MAIN
    DEPS -.->|"JWKS, cached"| CLERK
    SPA --> DOCS
    SPA -->|"POST, reads SSE body"| GEN
    SPA -->|"POST, reads SSE body"| CHAT

    MAIN --> DEPS
    DOCS --> DEPS
    GEN --> DEPS
    CHAT --> DEPS
    DOCS --> STORE
    GEN --> STORE
    GEN --> CTX
    GEN --> AGENTS
    CHAT --> CSTORE
    CHAT --> CTX
    CHAT --> AGENTS
    CTX --> AGENTS
    AGENTS -->|"messages.create / messages.stream"| ANTHROPIC
    DEPS --> DB
    STORE --> DB
    CSTORE --> DB
    CTX --> DB
    DB --> SQL

    classDef ext fill:#fff4e5,stroke:#d08770
    class ANTHROPIC,SQL ext
```

## How to read it

**Every data route is project-scoped and authenticated.**
`require_project` (`backend/routes/deps.py`) resolves the Clerk session token to a `User` (created on that Clerk user's first request), loads the `Project`, and returns 404 — not 403 — when the caller does not own it, so a project id belonging to someone else is indistinguishable from one that never existed.

**Only the generation routes — `routes/generate.py` and `routes/chat.py` — talk to the agents.**
`routes/documents.py` is plain CRUD.
This is the seam worth keeping: document storage has no idea a model exists.

**The agents never touch the database.**
Each agent function takes a plain `state` dict and returns a plain dict; assembling that state from documents and persisting the result is the route's job.
That is why the agents are testable without a session.

## Dev versus production

The two setups differ only in who serves the JavaScript.

```mermaid
graph LR
    subgraph dev["make dev"]
        B1["Browser<br/>localhost:5173"] -->|"/auth /projects /static"| V["Vite dev server<br/>proxy → :8000"]
        V --> F1["FastAPI :8000"]
        B1 -->|"app JS, HMR"| V
    end

    subgraph prod["Docker / Railway"]
        B2["Browser"] --> F2["FastAPI :8000"]
        F2 -->|"/assets/*"| D["frontend/dist<br/>built by vite build"]
        F2 -->|"any unmatched GET"| I["dist/index.html"]
    end
```

In dev, `:5173` is the URL you want — `frontend/vite.config.ts` proxies `/auth`, `/me`, `/agents`, `/projects`, and `/static` to the backend, and `:8000` serves the API but not the dev UI.
Set `BACKEND_PORT` to point the proxy somewhere other than `:8000`, which is how a second checkout runs alongside the first.

In production the SPA catch-all in `main.py` is registered last, so it only handles GET paths that no API route or static mount claimed.
That is what makes a hard reload on `/p/{id}/d/{id}` resolve to the app instead of a 404, while unknown API paths still 404 normally.
