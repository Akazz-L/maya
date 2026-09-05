# Diagrams

Mermaid diagrams of how Maya is put together.
GitHub, VS Code, and most IDEs render these files directly — there is no build step and no extra dependency.

| File | What it covers |
|---|---|
| [01-system-overview.md](01-system-overview.md) | Containers and the path a request takes, in dev and in production |
| [02-backend-data-model.md](02-backend-data-model.md) | Database tables, the legacy tables to ignore, and the agent state contract |
| [03-backend-workflows.md](03-backend-workflows.md) | Plan / Check, the streaming draft and revise, and summary caching |
| [04-frontend-architecture.md](04-frontend-architecture.md) | Provider tree, module layers, and who owns which piece of state |
| [05-frontend-flows.md](05-frontend-flows.md) | Auth and session expiry, the document lifecycle, and generating a draft |

## Keeping them true

Each diagram names the files it describes.
When you change one of those files, check the diagram that covers it:

| If you change | Update |
|---|---|
| `backend/db_models.py`, `alembic/versions/*` | 02 |
| `backend/routes/*.py`, `backend/agents/*.py`, `backend/context.py` | 03 (and 02 for the agent state contract) |
| `frontend/src/App.tsx`, `main.tsx`, `hooks/*`, `api/*` | 04 |
| `frontend/src/screens/WorkspaceScreen.tsx`, `auth/*` | 05 |
| A new container, port, or external service | 01 |

These diagrams show structure and control flow, not every field and prop.
Prefer deleting a diagram over letting it describe code that no longer exists.
