# Frontend architecture

React 19 + Vite, with React Router for navigation and TanStack Query for server state.
Source lives in `frontend/src/`.

## Provider and component tree

```mermaid
graph TD
    ROOT["main.tsx — createRoot"] --> SM["StrictMode"]
    SM --> BR["BrowserRouter"]
    BR --> QCP["QueryClientProvider<br/>refetchOnWindowFocus: false · retry: false"]
    QCP --> AP["AuthProvider<br/>token · login · register · logout"]
    AP --> APP["App — route table"]

    APP --> LOGIN["/login → AuthScreen"]
    APP --> GUARD["RequireAuth<br/>no token → redirect to /login"]
    APP --> CATCH["* → / or /login"]

    GUARD --> PROJ["/ → ProjectsScreen"]
    GUARD --> WS1["/p/:projectId → WorkspaceScreen"]
    GUARD --> WS2["/p/:projectId/d/:documentId → WorkspaceScreen"]

    WS1 --- WS["WorkspaceScreen"]
    WS2 --- WS
    WS --> SIDE["DocumentSidebar<br/>select · create · rename<br/>delete · drag to reorder"]
    WS --> TB["ChapterToolbar<br/>chapter documents only"]
    WS --> ED["DocumentEditor<br/>title · brief · ProseEditor"]
    ED --> RL["RewriteLayer<br/>chapters only: pill · prompt · review bar"]
    WS --> PP["PlanPanel<br/>resizable, tabbed"]
    PP --> PF["PlanForm"]
    PP --> IL["IssuesList → IssueCard"]

    classDef screen fill:#eef4ff,stroke:#5b7cba
    class LOGIN,PROJ,WS1,WS2,WS screen
```

`AuthProvider` sits **inside** `BrowserRouter` on purpose: it calls `useNavigate` to redirect on logout, which is only legal beneath a router.

`ChapterToolbar` and `PlanPanel` render only when the open document has `kind === 'chapter'`.
Bible and note documents get the editor and nothing else — they have no plan, no issues, and no generation actions.

The body is a CodeMirror 6 view (`ProseEditor`), not a textarea, so the chapter rewrite flow can draw over the real document.
`editor/rewriteExtension.ts` holds the overlay as editor state and renders it as decorations; `RewriteLayer` drives it and only ever changes the document through the single Accept transaction, which is why an accepted rewrite autosaves and undoes like any other edit.

## Module layers

```mermaid
graph TD
    subgraph screens["screens/ — routing, layout, orchestration"]
        AS["AuthScreen"]
        PS["ProjectsScreen"]
        WSS["WorkspaceScreen"]
    end

    subgraph components["components/ — presentational"]
        CMP["DocumentSidebar · DocumentEditor · ProseEditor<br/>RewriteLayer · RewritePrompt · RewriteReviewBar<br/>ChapterToolbar · PlanPanel<br/>PlanForm · IssuesList · IssueCard<br/>ui/ — button, card, input, select, textarea"]
    end

    subgraph hooks["hooks/ — server state"]
        Q["queries.ts<br/>useDocuments · useDocument<br/>useCreateDocument · useDeleteDocument<br/>useReorderDocuments"]
        DS["useDraftStream.ts<br/>isStreaming · error · run()"]
        SR["useSelectionRewrite.ts<br/>idle → prompting → streaming → reviewing"]
    end

    subgraph api["api/ — transport"]
        EP["endpoints.ts<br/>typed wrappers per route"]
        CL["client.ts<br/>request(): JSON in/out, throws detail"]
        ST["stream.ts<br/>streamPost(): SSE frame parser"]
        TY["types.ts<br/>mirrors the backend shapes"]
    end

    subgraph auth["auth/"]
        AC["AuthContext.tsx"]
        TK["token.ts<br/>localStorage + unauthorized hook"]
    end

    AS --> AC
    PS --> EP
    WSS --> Q
    WSS --> DS
    WSS --> EP
    WSS --> CMP
    PS --> CMP
    AS --> CMP
    Q --> EP
    DS --> ST
    EP --> CL
    CL --> TK
    ST --> TK
    AC --> EP
    AC --> TK
    EP -.-> TY
    CMP -.-> TY

    classDef layer fill:#f7f7f2,stroke:#999
```

The dependency arrows only point downward: components never call `api/` directly, and `api/` knows nothing about React.
`client.ts` and `stream.ts` both attach the bearer token and both handle a 401 the same way — they are separate because `EventSource` cannot issue a POST, so the streaming routes read `response.body` and parse `data: {…}\n\n` frames by hand.

One deliberate exception: **saving is not a hook.**
`WorkspaceScreen` calls `updateDocument` directly rather than through a mutation, so it can hold the in-flight promise in a ref and await it before opening a stream.
See [05](05-frontend-flows.md#generating-a-draft).

## Who owns which state

```mermaid
graph LR
    subgraph rq["React Query cache — server data"]
        K1["['projects']"]
        K2["['project', projectId]"]
        K3["documentsKey → ['documents', projectId]"]
        K4["documentKey → ['document', projectId, documentId]"]
    end

    subgraph ctx["AuthContext — session"]
        T["token · isAuthenticated"]
    end

    subgraph local["WorkspaceScreen — ephemeral UI"]
        L1["collapsed · panelHeight"]
        L2["panelOverride — { id, open }"]
        L3["streamBody · saveState · error"]
        L4["docVersion — editor remount key"]
        L5["pendingSave — ref to the in-flight save"]
    end

    subgraph ed["DocumentEditor — draft text"]
        E1["title · brief · body<br/>seeded once, never re-synced"]
    end

    subgraph ls["localStorage"]
        S1["maya.token"]
        S2["maya.sidebar.collapsed"]
        S3["maya.panel.height"]
    end

    T -.->|mirrored| S1
    L1 -.->|mirrored| S2
    L1 -.->|mirrored| S3
```

Two conventions are worth internalizing:

**`patchCache` writes to the query cache, `save` writes to the server.**
Generation results (`plan`, `issues`) are pushed into the cache with `qc.setQueryData` and separately persisted — no refetch round-trip, so the panel updates the instant the response lands.

**The editor's local state is seeded from props once and never re-synced.**
An effect that copied props into state would fight the user's in-flight typing.
Instead, when the server authoritatively rewrites a document — a different document, or a finished generation — `WorkspaceScreen` remounts the editor by changing its `key` (`${doc.id}:${docVersion}`).
The `bodyOverride` prop is the one bypass: during a stream it displays the server's text directly without touching local state.
