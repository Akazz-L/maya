# Design: Wire the React frontend to the authed, project-scoped API

**Date:** 2026-06-07
**Status:** Approved
**Follow-up to:** PR #3 (React + Vite + TypeScript frontend refactor). Stacks on branch
`refactor/react-frontend`.

## Context

PR #2 migrated the backend to PostgreSQL with multi-user auth. This reshaped the entire
API: every data route now lives under `/projects/{project_id}/...` and requires a JWT
`Authorization: Bearer` header, with new `/auth/register` and `/auth/token` endpoints. The
React frontend from PR #3 still calls the old flat, unauthenticated paths (`/bible`,
`/chapter/{n}/...`) and has no login or project concept, so it returns 401/404 against the
rebased backend. This change makes the frontend functional again: a login/register flow,
JWT handling on every request, and a project manager that scopes the existing workspace to a
selected project.

## Decisions

- **Project UI:** full project manager — list / create / open. No rename or delete (backend
  exposes no such endpoints; explicitly out of scope).
- **Auth:** login + self-serve registration (both endpoints already exist).
- **Token storage:** JWT in `localStorage` (key `maya.token`) — survives reloads, supports
  the reload-resume UX. Accepted trade-off: JS-readable (standard SPA risk).
- **Navigation:** `react-router-dom` with real URLs.

## Backend API (already exists, unchanged by this work)

- `POST /auth/register` `{email, password}` → `{user_id}` (201)
- `POST /auth/token` `{email, password}` → `{access_token, token_type}`
- `GET /projects` → `[{project_id, name, created_at}]`
- `POST /projects` `{name, bible_content?, outline_content?}` → `{project_id, name}` (201)
- `GET /projects/{id}` → `{project_id, name, bible_content, outline_content}`
- `GET|PUT /projects/{id}/bible`, `GET|PUT /projects/{id}/outline`
- `POST /projects/{id}/chapters/{n}/plan|check|draft/stream|revise/stream`
- `GET /projects/{id}/chapters/{n}` (saved), `GET …/state`, `PUT …/accept?overwrite=`

All `/projects/...` routes require `Authorization: Bearer <token>`.

## Architecture

### Routing & app shell
Add `react-router-dom`. `main.tsx` nests `BrowserRouter → QueryClientProvider → AuthProvider`.

| Route | Screen | Access |
|---|---|---|
| `/login` | `AuthScreen` (login + register toggle) | public |
| `/projects` | `ProjectsScreen` (manager) | protected |
| `/projects/:projectId` | `WorkspaceScreen` (BiblePanel + ChapterPanel) | protected |
| `*` | redirect → `/projects` if authed else `/login` | — |

`<RequireAuth>` wraps protected routes and redirects to `/login` when no token is present.

### Backend: SPA fallback (only backend change)
Add a last-matched catch-all to `backend/main.py` that returns `dist/index.html` for unmatched
**GET** paths, so hard-reloading `/projects/:id` in production (served by FastAPI) resolves to
the SPA instead of 404. It is registered after all API routes and returns the 503 build guard
when `dist` is absent. Paths under known API prefixes still 404 normally (FastAPI matches
explicit routes first). Dev mode is handled by Vite's own fallback.

### Auth layer
- `src/auth/token.ts` — `getToken() / setToken(t) / clearToken()` over `localStorage`.
- `src/auth/AuthContext.tsx` — provides `{ token, isAuthenticated, login, register, logout }`.
  - `login(email, password)` → `POST /auth/token`, store token.
  - `register(email, password)` → `POST /auth/register`, then auto-login (store token).
  - `logout()` → clear token, navigate to `/login`.
  - `useAuth()` hook for consumers.

### API layer changes
- `client.ts` — inject `Authorization: Bearer <token>` from `token.ts` on every request.
  On **401**: clear the token and redirect to `/login` (expired/invalid session), surfaced via
  an `onUnauthorized` handler registered by `AuthProvider` (no hard reload).
- `stream.ts` — same `Authorization` header on the SSE `fetch`; 401 handled the same way.
- `endpoints.ts` — add `login`, `register`, `listProjects`, `createProject`, `getProject`.
  Every existing function gains a `projectId` argument and repoints to the
  `/projects/{id}/...` paths above.
- `hooks/queries.ts` — bible/outline hooks take `projectId`; query keys include it.

### Screens / components
- `AuthScreen` — email + password form with a login⇄register toggle; inline error (401 bad
  credentials, 409 email already registered); on success navigate to `/projects`.
- `ProjectsScreen` — `useQuery(listProjects)` renders project cards (name + created date); a
  "New project" action (name + optional bible/outline seed) calls `createProject` then opens
  `/projects/{id}`.
- `WorkspaceScreen` — reads `:projectId`, renders the existing `BiblePanel` + `ChapterPanel`
  with `projectId` threaded through, plus a top bar (project name, "Back to projects",
  "Log out").
- `ChapterPanel` / `BiblePanel` — accept a `projectId` prop and thread it into every
  endpoint, query, mutation, and stream call.

### Error handling
- 401 on any data request → `logout()` + redirect to `/login`.
- Auth-form errors shown inline on the form.
- Project `GET` 404 → redirect to `/projects`.

## Testing (vitest + React Testing Library, existing setup)

- Unit: `token.ts` (get/set/clear); `AuthContext` (login stores token, logout clears);
  `endpoints` build the correct project-scoped URLs.
- Component: `AuthScreen` (submit calls login, shows error); `ProjectsScreen` (lists projects,
  create navigates).
- Existing `workflowReducer`, `stream`, and `PlanForm` tests remain green.

## Misc

- Update `vite.config.ts` dev proxy to the new prefixes: `/auth`, `/projects`.

## Out of scope

- Rename / delete projects (no backend support).
- Refresh tokens, password reset, email verification.
- A per-project chapter-list endpoint — chapter navigation stays number-based via the outline.
