# Backend workflows

Every generation route lives in `backend/routes/generate.py` or `backend/routes/chat.py` under the prefix `/projects/{project_id}/documents/{document_id}`, and every one of them starts the same way: authenticate, resolve the project, refuse if the writer's AI budget is spent, insist the document is a chapter, then assemble agent state.

Every model call runs on the writer's chosen model (`user.model_key`) and reports its token usage to a `Meter` (`backend/usage.py`).
The meter holds that usage in memory and writes it as `usage_events` rows in the same commit that persists the route's own result.
On any failure after a billed call it still writes what was collected, so spend is never dropped with the error.

## Plan and Check

The two non-streaming routes.
They differ only in which agent they call and which column they write.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Frontend
    participant R as routes/generate.py
    participant D as routes/deps.py + auth.py
    participant U as usage.py
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

    R->>U: require_ai_budget(user)
    U->>DB: SUM usage_events.cost_micro_usd for this UTC month
    alt spend has reached the budget
        U-->>UI: 402 AI budget for this month is used up
    end
    U-->>R: User

    R->>S: require_chapter → get_document()
    S->>DB: SELECT document scoped to project
    alt kind is bible or note
        R-->>UI: 400 Cannot generate on a {kind} document
    end
    S-->>R: Document

    Note over R,C: build_chapter_state() assembles the agent state dict
    R->>S: get_bible_body(project_id)
    R->>C: build_previous_summaries(project_id, position, model_key, meter.add)
    C-->>R: summaries of earlier chapters (any refreshed one is metered)
    Note right of R: outline_beat ← document.brief<br/>scene_plan ← document.plan or {}

    alt Check
        R->>R: state["draft"] = document.body
    end

    R->>A: planner_node(state, model_key) / checker_node(state, model_key)
    A->>API: messages.create(**request_params(model_key), tools=[…], tool_choice=forced)
    API-->>A: tool_use block
    alt no tool_use block, or any other failure
        A-->>R: RuntimeError
        R->>DB: meter.flush() — the refreshed summaries were billed, commit
        R-->>UI: 500
    end
    A-->>R: {scene_plan, usage} / {continuity_issues, usage}

    R->>R: meter.add("plan" or "check", usage)
    R->>DB: document.plan = … (or document.issues = …), insert usage_events, commit
    R-->>UI: {"plan": …, "usage": …} / {"issues": …, "usage": …}
```

**The budget gate is the same on all five routes, and it is pre-flight only.**
It reads the ledger and reserves nothing, and a call's cost lands only when the call finishes.
So a request that starts under the cap always runs to completion, and a writer with several requests in flight at once can overshoot by one call per request.
Because the gate runs before any `StreamingResponse` exists, a blocked stream fails as a plain `402`, not as an error frame.

**The `usage` in every response is the writer's meter after this call**, so the editor updates its spend without polling.

**Planning is optional.**
Nothing calls the planner except `/plan`; a chapter without a plan is drafted in the chat from its brief and the writer's message.

Note what **Check** does *not* do: it reads `document.body` from the database, not from the request.
Whatever the writer has typed but not yet saved is invisible to it — which is why the frontend saves pending edits before calling this route (see [05](05-frontend-flows.md#saving-before-the-server-reads)).

## Revise — server-sent events

Revise rewrites the chapter to fix the issues Check reported, streaming the result.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Frontend
    participant R as routes/generate.py
    participant A as agents/reviser.py
    participant API as Anthropic API
    participant DB as Database

    UI->>R: POST …/revise/stream
    R->>R: require_project → require_ai_budget → require_chapter
    Note right of R: A spent budget is refused here with a 402,<br/>before any stream exists.
    alt the chapter has no body, or no issues
        R-->>UI: 400 There is nothing to revise
    end

    R->>R: build_chapter_state(), then draft ← body, continuity_issues ← issues
    Note right of R: Refreshed summaries go to the meter.<br/>If this step fails, they are flushed before the 500.
    R-->>UI: 200 text/event-stream<br/>Cache-Control: no-cache, X-Accel-Buffering: no

    R->>A: reviser_token_stream(state, model_key, meter.add)
    A->>API: messages.stream(**request_params(model_key))

    loop for each text delta
        API-->>A: text chunk
        A-->>R: yield text
        R-->>UI: data: {"type":"delta","text":"…"}
    end
    A->>R: on_usage(usage) once the final message arrives

    alt the stream completed
        R->>DB: document.body = the revision, summary_hash = None, insert usage_events, commit
        R-->>UI: data: {"type":"done","body":"<full body>","usage":{…}}
    else cut off at max_tokens, or any other exception
        R->>DB: meter.flush() — usage billed so far, commit
        R-->>UI: data: {"type":"error","detail":"…"}
        Note right of R: The response is already 200 and streaming,<br/>so failures arrive as a frame, never a status code.
    end
```

**The error frame exists because the status code is already spent.**
Headers go out before the first token, so nothing after that point can be reported as a 4xx or 5xx.
The client must treat an `error` frame as a failed request.

**A truncated revision is an error, not a shorter chapter.**
Revise replaces the body wholesale, so a reply cut off at `max_tokens` would silently delete the end of the chapter.
`reviser_token_stream` raises `RevisionTruncatedError` instead, and the route writes the body only after the stream completes.

**`X-Accel-Buffering: no`** tells a reverse proxy not to buffer the response, which would otherwise hold the tokens back and deliver them in one lump at the end.

## Chapter chat

`routes/chat.py` is where drafting happens.
Each writer message is one turn: one model call (two when an edit needs correcting), streamed back as reply text plus at most one proposal.
The route never changes `document.body`; it stores the proposal, and the editor applies it if the writer accepts.

```mermaid
sequenceDiagram
    autonumber
    participant UI as Frontend
    participant R as routes/chat.py
    participant CS as chat_storage.py
    participant A as agents/chat.py
    participant API as Anthropic API
    participant DB as Database

    UI->>R: POST …/chat/stream {content}
    R->>R: require_project → require_ai_budget → require_chapter
    R->>CS: list_messages(document)
    alt the last reply's proposal is unresolved
        R-->>UI: 409 Accept or discard the pending proposal first
    end
    R->>R: build_chapter_state() + draft, history, message<br/>base_hash = sha256(body)
    R-->>UI: 200 text/event-stream

    R->>A: chat_event_stream(state, model_key, meter.add)
    A->>API: messages.stream(system = rules + bible, history, chapter + message, tools)
    loop reply text
        API-->>A: text delta
        A-->>R: TextDelta
        R-->>UI: data: {"type":"delta","text":"…"}
    end
    opt write_draft, streamed as it is written
        API-->>A: input_json snapshot
        A-->>R: ProposalProgress
        R-->>UI: data: {"type":"proposal_progress","mode":"…","text":"…"}
    end
    A->>A: build_proposal(body, tool call) → proposed_body
    alt the edits do not match the chapter
        A->>API: the reply + a tool_result marked is_error, once
    end
    A-->>R: ProposalReady

    R->>CS: add_turn(message, reply, proposal + base_hash, outcome null)
    R->>DB: insert both messages and usage_events, commit
    R-->>UI: data: {"type":"done","messages":[user, assistant],"usage":{…}}

    Note over UI: The writer reviews the proposal in the editor
    UI->>R: POST …/chat/messages/{id}/outcome {accepted · discarded · stale}
    R->>DB: proposal.outcome = …, proposed_body = null, commit
```

**A failed turn leaves the conversation as it was.**
Both messages are written in the same commit as the usage, and only once the reply is complete.
On an `error` frame nothing but the billed usage is stored, so the writer can simply send again.

**The next message waits for an outcome.**
While a proposal is unresolved the route answers 409.
The outcome is stated at the start of the following message, so the model is never asked anything while assuming a discarded change is in the text.

**History is rendered as text.**
Earlier turns go to the model as plain user and assistant messages, with a proposal described (a draft of N words, or its list of edits) rather than replayed as a tool call.
A writer can switch models mid-conversation, and no request depends on how an earlier model's thinking blocks must be replayed.
The rules and the bible come first and the chapter text last, so the stable prefix is cacheable; the model sees the most recent 40 messages.

**Edits are validated before the writer sees them.**
Every `find` must occur exactly once in the current body, and no two edits may overlap.
A call that fails gets one correction inside the turn; a second failure becomes an `error` frame.

## Summary caching

`build_previous_summaries` in `backend/context.py` is called by every generation route.
Without caching, drafting chapter 12 would summarize eleven chapters from scratch on every single click.

```mermaid
flowchart TD
    START(["build_previous_summaries(project_id, position, model_key, on_usage)"]) --> Q["SELECT documents<br/>kind = 'chapter'<br/>AND position &lt; this one<br/>AND body != ''<br/>ORDER BY position"]
    Q --> CAP["Keep the last MAX_PRIOR_CHAPTERS (10)"]
    CAP --> SPLIT{"For each document:<br/>summary is NULL<br/>or summary_hash != sha256(body)?"}
    SPLIT -->|"no — cache is valid"| REUSE["Reuse document.summary"]
    SPLIT -->|"yes — stale"| STALE["Collect into the stale list"]

    STALE --> ANY{"any stale?"}
    ANY -->|no| OUT
    ANY -->|yes| GATHER["asyncio.gather(summarize_node(d.body, model_key) …, return_exceptions=True)<br/>one concurrent API call per stale document"]
    GATHER --> WRITE["After the gather returns, for each summary that came back:<br/>write summary + summary_hash, on_usage(usage)<br/>then commit"]
    WRITE --> FAILED{"did any summary fail?"}
    FAILED -->|yes| RAISE(["Raise the first failure"])
    FAILED -->|no| OUT
    REUSE --> OUT(["Return summaries, oldest first"])

    style GATHER fill:#fff4e5,stroke:#d08770
```

**Only the API calls run concurrently.** `AsyncSession` is not concurrency-safe, so every database write happens *after* `gather` returns, never inside the coroutines it is awaiting.
For the same reason usage is reported through `on_usage` (the route's `meter.add`), which only appends to a list; the meter writes it later, in one commit.

**A failed summary does not discard its siblings.**
Each summary that came back was a billed call, so it is stored and reported before the first failure is raised.

**The 10-chapter cap is a cost ceiling.**
Without it, the first generation on chapter 30 fires 29 model calls.
With it, the planner and checker see the ten most recent chapters — a deliberate trade of long-range continuity for a bounded bill.

**Empty documents are skipped entirely**, so an outlined-but-unwritten chapter in the middle of the book costs nothing and contributes nothing.

## Selection rewrite

`/rewrite/stream` is the one generation route that never writes to the document; the only thing it persists is its usage.
It also skips `build_chapter_state`, so it refreshes no summaries.
The client sends the selected span plus a window of prose on each side; the rewriter returns only the replacement; the client splices it in when the writer accepts, and the ordinary autosave persists it.

```mermaid
sequenceDiagram
    participant B as Browser (RewriteLayer)
    participant R as routes/generate.py
    participant A as agents/rewriter.py
    participant M as Anthropic

    B->>R: POST /rewrite/stream {instruction, selection, before, after}
    R->>R: require_ai_budget · require_chapter · get_bible_body
    R->>A: rewriter_token_stream(state, model_key, meter.add)
    A->>M: messages.stream(system=bible + rules, user=instruction + context + passage)
    loop each token
        M-->>A: text delta
        A-->>R: yield text
        R-->>B: data: {"type":"delta","text"}
    end
    A->>R: on_usage(usage), even when the reply was truncated
    alt completed
        R->>R: meter.flush() — insert usage_events, commit
        R-->>B: data: {"type":"done","body": replacement,"usage":{…}}
    else truncated at max_tokens, or any other failure
        R->>R: meter.flush()
        R-->>B: data: {"type":"error","detail":"…"}
    end
    Note over B: writer reviews the diff in place
    B->>B: Accept → one editor transaction → autosave PATCH /documents/{id}
```

The model never sees the rest of the chapter and never emits it, so everything outside the selection is preserved by construction.
