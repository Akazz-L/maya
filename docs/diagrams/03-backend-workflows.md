# Backend workflows

Every generation route lives in `backend/routes/generate.py` under the prefix `/projects/{project_id}/documents/{document_id}`, and every one of them starts the same way: authenticate, resolve the project, insist the document is a chapter, then assemble agent state.

## Plan and Check

The two non-streaming routes.
They differ only in which agent they call and which column they write.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Frontend
    participant R as routes/generate.py
    participant D as routes/deps.py + auth.py
    participant S as doc_storage.py
    participant C as context.py
    participant A as agents/planner or checker
    participant API as Anthropic API
    participant DB as Database

    UI->>R: POST …/plan  (or …/check)
    R->>D: require_project(project_id)
    D->>DB: decode JWT → load User, load Project
    alt not found or owned by someone else
        D-->>UI: 404 Project not found
    end
    D-->>R: Project

    R->>S: _require_chapter → get_document()
    S->>DB: SELECT document scoped to project
    alt kind is bible or note
        R-->>UI: 400 Cannot generate on a {kind} document
    end
    S-->>R: Document

    Note over R,C: _base_state() assembles the agent state dict
    R->>S: get_bible_body(project_id)
    R->>C: build_previous_summaries(project_id, document.position)
    C-->>R: summaries of earlier chapters
    Note right of R: outline_beat ← document.brief<br/>scene_plan ← document.plan or {}

    alt Check
        R->>R: state["draft"] = document.body
    end

    R->>A: planner_node(state) / checker_node(state)
    A->>API: messages.create(tools=[…], tool_choice=forced)
    API-->>A: tool_use block
    alt no tool_use block in the response
        A-->>UI: RuntimeError → 500
    end
    A-->>R: {scene_plan} / {continuity_issues}

    R->>DB: document.plan = … (or document.issues = …), commit
    R-->>UI: {"plan": …} / {"issues": …}
```

Note what **Check** does *not* do: it reads `document.body` from the database, not from the request.
Whatever the writer has typed but not yet saved is invisible to it — which is why the frontend flushes its pending autosave before calling this route (see [05](05-frontend-flows.md#generating-a-draft)).

## Draft and Revise — server-sent events

Both streaming routes share the same skeleton and differ in two places: what seeds the state, and whether the finished prose is appended or replaces the body.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Frontend
    participant R as routes/generate.py
    participant A as agents/drafter.py
    participant API as Anthropic API
    participant DB as Database

    UI->>R: POST …/draft/stream  {plan}
    R->>R: require_project → _require_chapter

    Note over R,DB: The plan is persisted BEFORE the stream opens,<br/>so an edit made in the panel survives a failed generation.
    R->>DB: document.plan = body.plan, commit

    R->>R: _base_state(), then scene_plan ← body.plan
    R->>R: remember `existing = document.body`
    R-->>UI: 200 text/event-stream<br/>Cache-Control: no-cache, X-Accel-Buffering: no

    R->>A: drafter_token_stream(state)
    A->>API: messages.stream(temperature=0.9, max_tokens=4096)

    loop for each text delta
        API-->>A: text chunk
        A-->>R: yield text
        R-->>UI: data: {"type":"delta","text":"…"}
    end

    alt the stream completed
        R->>R: draft = "".join(buffer)
        Note right of R: draft → existing + "\n\n" + draft<br/>revise → replaces the body wholesale
        R->>DB: document.body = …, summary_hash = None, commit
        R-->>UI: data: {"type":"done","body":"<full body>"}
    else any exception mid-stream
        R-->>UI: data: {"type":"error","detail":"…"}
        Note right of R: The response is already 200 and streaming,<br/>so failures arrive as a frame, never a status code.
    end
```

Three things this diagram is trying to make obvious:

**The error frame exists because the status code is already spent.**
Headers go out before the first token, so nothing after that point can be reported as a 4xx or 5xx.
The client must treat an `error` frame as a failed request.

**`X-Accel-Buffering: no`** tells a reverse proxy not to buffer the response, which would otherwise hold the tokens back and deliver them in one lump at the end.

**Draft appends, revise replaces.**
`/draft/stream` concatenates onto whatever body already exists — running it twice gives you two scenes.
`/revise/stream` overwrites, because it was given the current draft plus its issues and returned a corrected version of the same text.
Its state seeds `draft` from `document.body` and `continuity_issues` from `document.issues`, which is exactly the condition that makes `_build_messages` take its revision branch.

Both paths clear `summary_hash`, because the body just changed and any cached summary of it is now stale.

## Summary caching

`build_previous_summaries` in `backend/context.py` is called by every generation route.
Without caching, drafting chapter 12 would summarize eleven chapters from scratch on every single click.

```mermaid
flowchart TD
    START(["build_previous_summaries(project_id, position)"]) --> Q["SELECT documents<br/>kind = 'chapter'<br/>AND position &lt; this one<br/>AND body != ''<br/>ORDER BY position"]
    Q --> CAP["Keep the last MAX_PRIOR_CHAPTERS (10)"]
    CAP --> SPLIT{"For each document:<br/>summary is NULL<br/>or summary_hash != sha256(body)?"}
    SPLIT -->|"no — cache is valid"| REUSE["Reuse document.summary"]
    SPLIT -->|"yes — stale"| STALE["Collect into the stale list"]

    STALE --> ANY{"any stale?"}
    ANY -->|no| OUT
    ANY -->|yes| GATHER["asyncio.gather(summarize_node(d.body) …)<br/>one concurrent API call per stale document"]
    GATHER --> WRITE["After the gather returns:<br/>write summary + summary_hash, commit"]
    WRITE --> OUT
    REUSE --> OUT(["Return summaries, oldest first"])

    style GATHER fill:#fff4e5,stroke:#d08770
```

**Only the API calls run concurrently.** `AsyncSession` is not concurrency-safe, so every database write happens *after* `gather` returns, never inside the coroutines it is awaiting.

**The 10-chapter cap is a cost ceiling.**
Without it, the first generation on chapter 30 fires 29 model calls.
With it, the planner and checker see the ten most recent chapters — a deliberate trade of long-range continuity for a bounded bill.

**Empty documents are skipped entirely**, so an outlined-but-unwritten chapter in the middle of the book costs nothing and contributes nothing.

## Selection rewrite

`/rewrite/stream` is the one generation route that writes nothing.
The client sends the selected span plus a window of prose on each side; the rewriter returns only the replacement; the client splices it in when the writer accepts, and the ordinary autosave persists it.

```mermaid
sequenceDiagram
    participant B as Browser (RewriteLayer)
    participant R as routes/generate.py
    participant A as agents/rewriter.py
    participant M as Anthropic

    B->>R: POST /rewrite/stream {instruction, selection, before, after}
    R->>R: _require_chapter · get_bible_body
    R->>A: rewriter_token_stream(state)
    A->>M: messages.stream(system=bible + rules, user=instruction + context + passage)
    loop each token
        M-->>A: text delta
        A-->>R: yield text
        R-->>B: data: {"type":"delta","text"}
    end
    R-->>B: data: {"type":"done","body": replacement}
    Note over B: writer reviews the diff in place
    B->>B: Accept → one editor transaction → autosave PATCH /documents/{id}
```

The model never sees the rest of the chapter and never emits it, so everything outside the selection is preserved by construction.
