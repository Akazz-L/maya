# Frontend flows

Three paths through the app, from the user's first click to the database.

## Auth and session expiry

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant AS as AuthScreen
    participant AC as AuthContext
    participant EP as api/endpoints
    participant TK as auth/token.ts
    participant BE as Backend

    U->>AS: submit email + password
    alt register
        AS->>AC: register()
        AC->>EP: POST /auth/register  (authed: false)
        EP->>BE: create user
        Note over AC: then auto-login, so a new<br/>user lands straight in the app
    end
    AS->>AC: login()
    AC->>EP: POST /auth/token  (authed: false)
    EP->>BE: verify password
    alt bad credentials
        BE-->>AS: 401 → shown on the form, no logout
    end
    BE-->>AC: {access_token}
    AC->>TK: setToken() → localStorage['maya.token']
    AC->>AC: setTokenState → isAuthenticated = true
    Note over AS: /login redirects to / once authenticated
```

The login and register calls pass `authed: false` for one reason: their 401 means "wrong password", not "session expired", and must surface on the form rather than triggering a logout.

Every other request goes through the shared 401 path:

```mermaid
stateDiagram-v2
    [*] --> SignedOut
    SignedOut --> SignedIn : login / register succeeds
    SignedIn --> SignedOut : user clicks Log out
    SignedIn --> SignedOut : any authed request returns 401

    state SignedOut {
        [*] --> AtLogin : RequireAuth redirects\nprotected routes to /login
    }
    state SignedIn {
        [*] --> Projects
        Projects --> Workspace : open a project
        Workspace --> Projects : ← Projects
        Workspace --> Workspace : select another document
    }
```

The 401 path has an indirection worth understanding.
`api/client.ts` is not a React component, so it cannot navigate.
Instead it calls `handleUnauthorized()`, which clears the token and invokes whatever handler was registered — and `AuthProvider` registers one, in an effect, that drops the token from state and navigates to `/login`.
That is the whole job of `setUnauthorizedHandler` in `auth/token.ts`: it lets the transport layer log the app out without importing React.

## Opening and editing a document

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant WS as WorkspaceScreen
    participant RQ as React Query cache
    participant ED as DocumentEditor
    participant BE as Backend

    U->>WS: navigate to /p/{pid}
    WS->>BE: GET /projects/{pid} · GET …/documents
    BE-->>RQ: project, document summaries
    Note over WS: With no document in the route,<br/>open the bible (or the first document)
    WS->>WS: navigate to /p/{pid}/d/{did}, replace: true

    WS->>BE: GET …/documents/{did}
    BE-->>RQ: DocumentDetail — body, brief, plan, issues
    RQ-->>ED: mounted with key `${doc.id}:${docVersion}`

    loop while typing
        U->>ED: keystroke in title / brief / body
        ED->>ED: queueSave() — merge into the pending patch,<br/>restart the 800 ms timer
    end
    ED->>WS: onSave(patch) after the debounce
    WS->>WS: saveState = 'saving' — the promise is kept in pendingSave
    WS->>BE: PATCH …/documents/{did}
    BE-->>WS: the updated document
    WS->>RQ: setQueryData(documentKey, doc)
    Note over WS: a title change also invalidates<br/>documentsKey, so the sidebar relabels
    WS->>ED: saveState = 'saved'

    U->>WS: select a different document
    Note over ED: unmount flushes the pending patch<br/>rather than cancelling it
    ED->>WS: onSave(patch) via onSaveRef
```

Two details in `DocumentEditor` exist to prevent lost edits:

**Patches accumulate rather than replace.** Editing the title and then the body inside one 800 ms window must not drop the title, so `queueSave` merges into a pending object instead of overwriting it.

**Unmount flushes, it does not cancel.**
Switching documents unmounts the editor mid-debounce; without the flush, the last edits before the switch vanish.
`onSaveRef` is updated in an effect rather than during render precisely so that on unmount it still holds the *outgoing* document's save function — the patch lands on the right document.

## Generating a draft

The most intricate flow in the app, because the client and the server both want to write `body`.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant WS as WorkspaceScreen
    participant ED as DocumentEditor
    participant DS as useDraftStream
    participant ST as api/stream.ts
    participant BE as Backend

    U->>WS: click Generate Draft
    alt the document has no plan yet
        WS->>BE: POST …/plan
        BE-->>WS: {plan}
        WS->>WS: patchDocument(id, {plan})
    end
    WS->>WS: view = write, so the stream is in sight

    rect rgb(255, 244, 229)
        Note over WS,BE: The ordering that matters
        WS->>WS: await pendingSave.current
        Note right of WS: The server appends to the body it has.<br/>Without this wait it appends to a stale one<br/>and the writer's last keystrokes vanish.
    end

    WS->>WS: streamBody = current body → editor goes read-only
    WS->>DS: run(draftStreamUrl, {plan})
    DS->>DS: isStreaming = true
    DS->>ST: streamPost()
    ST->>BE: POST …/draft/stream

    loop each SSE frame
        BE-->>ST: data: {"type":"delta","text":"…"}
        ST->>WS: onDelta → streamBody += text
        WS->>ED: bodyOverride — rendered without touching local state
    end

    alt success
        BE-->>ST: data: {"type":"done","body":"<full body>"}
        ST->>WS: onDone(full)
        WS->>WS: patchCache({body: full})
        WS->>WS: streamBody = undefined, docVersion++
        Note over ED: the key change remounts the editor<br/>onto the server's authoritative body
    else error frame or network failure
        ST-->>DS: throw
        DS->>WS: error message
        WS->>WS: streamBody = undefined — the editor keeps its own text
    end
    DS->>DS: isStreaming = false
```

**`pendingSave` is the point of the whole diagram.**
The server's draft route appends to `document.body` as it exists in the database.
If a debounced autosave is still in flight when the stream opens, the append lands on the previous version and the writer's last sentence is gone.
Holding the in-flight promise in a ref and awaiting it first is what makes that impossible — and it is why saving bypasses React Query's mutation machinery.
`Check` awaits the same promise for the same reason: it reads `document.body` server-side.

**The editor is read-only for the duration** (`readOnly={stream.isStreaming}`), so there is no window in which the user and the server are both appending.

**Revise takes the same path** with a `null` request body — the server already has the draft and the issues it needs — and its `done` frame replaces the body rather than extending it.

## Chapter views

A chapter fills its pane with one of three views, picked from the Write / Plan / Issues switcher in `ChapterToolbar`.
The choice is `chapterView` in `WorkspaceScreen`, and it resets to Write whenever the route's document changes.
The reset happens during render rather than in an effect, so the previous document's view never paints over the new one.

```mermaid
flowchart TD
    OPEN(["Writer opens the Plan view"]) --> A{"Does the chapter have a plan?"}
    A -->|yes| SHOW(["Show it — no model call"])
    A -->|no| B{"Busy, or out of AI budget?"}
    B -->|no| GEN["POST …/plan<br/>'Planning from your brief…'"]
    B -->|yes| EMPTY(["Empty state — Start a blank plan<br/>(and Generate plan when in budget)"])
    GEN -->|ok| SHOW
    GEN -->|error| FAIL(["Retry, or Start a blank plan"])
```

**The editor is hidden, not unmounted.**
It stays mounted behind the Plan and Issues views, so it keeps its undo history, scroll position, and selection.

**Regenerate offers Undo instead of a confirm dialog.**
The plan it replaces is kept in `undoState`, tagged with its document id, and Undo saves it back.
Editing the plan by hand, leaving the Plan view, or switching documents forgets it.

**Plan and Check pass the document id as the mutation variable.**
A result that lands after the writer has switched documents is written to the document it was asked for, not the one on screen.
A regenerate also awaits `pendingSave` first, so a plan edit still in flight cannot land after the new plan and restore the old one.

Generate Draft and Revise switch back to Write so the stream is in sight, and Check switches to Issues when its result arrives.
The switcher itself is never disabled: changing views calls no model, and a writer must be able to leave the Plan view while a plan generates.
