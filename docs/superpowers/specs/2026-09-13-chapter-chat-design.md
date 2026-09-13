# Chapter Chat — Design

**Date:** 2026-09-13
**Status:** Approved (implementation in progress)

## Summary

Planning becomes optional.
Generate Draft no longer runs the planner on its own; the planner runs only when the writer clicks Generate Plan.

Every AI change to a chapter's body — drafting from a prompt, drafting from the plan, continuing, rewriting, or targeted edits — now goes through a per-chapter chat in a collapsible pane beside the editor.
The assistant replies in text and can attach one proposal per reply.
A proposal streams into the editor, is reviewed there as a word-level diff, and changes nothing until the writer accepts it.

Revise-from-issues and selection rewrite keep their own paths.

## Goals

- Two workflows: plan → edit plan → draft from it, or draft straight from a prompt.
- A conversation that survives a reload, so follow-ups ("shorter", "undo the second change") work.
- One review mechanism for every chat change: diff in the editor, Accept or Discard, Accept undoable and autosaved.
- Targeted edits that leave every character outside the edited spans untouched.
- The model always knows whether its previous proposal was accepted.

## Non-goals

- Chat on the story bible or notes.
- Several proposals per reply, or several pending proposals at once.
- Multiple conversations per chapter.
- Replacing Revise (issues) or selection rewrite.

## Decisions

| Question | Decision |
|---|---|
| Memory | Persisted per chapter in a new `chat_messages` table; the model sees the conversation |
| How edits land | A proposal, reviewed as a diff in the editor, Accept / Discard |
| Draft from plan | The plan panel's Generate Draft posts a chat message; the chat agent reads the plan |
| Agent shape | One model call per message with two tools: `write_draft` and `edit_draft` |
| Toolbar | Generate Draft removed; a Chat toggle added |
| Old draft route | `/draft/stream` and the drafter's plan branch are removed |

## Backend

### Table — `chat_messages` (migration 0004)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `document_id` | uuid FK → documents.id, ON DELETE CASCADE, indexed | |
| `position` | int | 0-based order within the document; unique with `document_id` |
| `role` | string(16) | `user` or `assistant` |
| `content` | text | The message text; may be empty for an assistant reply that is only a proposal |
| `proposal` | JSON, nullable | Assistant only, see below |
| `created_at` | datetime | |

`delete_document` deletes the chapter's messages explicitly, because SQLite does not enforce the foreign key without a pragma.

A proposal is stored as:

```json
{
  "kind": "write" | "edit",
  "mode": "replace" | "append",
  "text": "…",
  "edits": [{"find": "…", "replace": "…"}],
  "base_hash": "sha256 of the body the proposal was computed against",
  "proposed_body": "the whole body after applying it; null once resolved",
  "outcome": null | "accepted" | "discarded" | "stale"
}
```

`mode` and `text` exist for `write`; `edits` exists for `edit`.
`proposed_body` is computed server-side for every kind, so the client never re-implements edit application; it is dropped once the proposal is resolved.

### Agent — `backend/agents/chat.py`

**Tools**, with `tool_choice: auto` and `disable_parallel_tool_use: true`:

- `write_draft {mode: "replace" | "append", text}` with `eager_input_streaming: true`, so prose streams as it is written.
- `edit_draft {edits: [{find, replace}]}`.

**Pure helpers**, unit-tested:

- `apply_edits(body, edits) -> str` — every `find` must be non-empty, occur exactly once in the original body, and not overlap another edit; all edits apply against original positions.
  Violations raise `ProposalError` listing each failing edit.
- `build_proposal(body, tool_name, tool_input) -> dict` — the proposal's fields plus `proposed_body`: replace takes the text, append joins with a blank line (no leading blank line on an empty body), edit applies the edits.
  A malformed write or empty edit list also raises `ProposalError`.
- `render_history(messages) -> list[dict]` — earlier turns as plain-text API messages.
- `build_turn(state) -> (system, messages)`.

**Prompt layout**, stable content first so the prefix caches:

1. System (cache breakpoint): role, prose rules carried over from the drafter, tool rules, then the story bible.
2. History (cache breakpoint on its last block): the most recent `MAX_HISTORY_MESSAGES` (40), trimmed to start on a user message.
   An assistant proposal is rendered as a bracketed description — a new draft of N words, N words appended, or the list of edits — never the full prose.
   The outcome of a proposal is stated at the start of the following user message, so an earlier message's rendering never changes once written.
3. The new user message: the chapter context (brief, scene plan if any, previous chapter summary, the current chapter text), the outcome of the last proposal if any, then the writer's message.

History is rendered as text rather than replayed `tool_use` / `tool_result` blocks.
That keeps each request independent of which model produced earlier turns (the writer can switch models mid-conversation) and of thinking-block replay rules.

**Streaming** — `chat_event_stream(state, model_key, on_usage)` yields:

- `TextDelta(text)` for reply text.
- `ProposalProgress(mode, text)` while `write_draft` input streams, from the SDK's parsed partial snapshot.
- `ProposalReady(tool_name, tool_input, proposed_body)` once the tool call completes and validates.

Usage is reported through `on_usage` after every API call.
A reply cut off at `max_tokens` raises `ChatTruncatedError`.
An `edit_draft` that fails `apply_edits` gets one in-turn correction: the reply is appended with its full content and a `tool_result` marked `is_error` explaining the failure, and the model tries again.
A second failure raises `ProposalError`.
A reply with neither text nor a proposal raises.

### Routes — `backend/routes/chat.py`

Under `/projects/{project_id}/documents/{document_id}`, chapter-only, owner-only:

- `GET /chat` → `{messages}`.
- `POST /chat/stream {content}` (1–8000 chars), budget-gated.
  Refused with 409 while the last assistant message has an unresolved proposal.
  Streams `delta`, `proposal_progress {mode, text}`, then `done {messages: [user, assistant], usage}`, or `error`.
  Both messages are written in one commit only when the turn succeeds, so a failed turn leaves no dangling user message; its usage is written either way.
- `POST /chat/messages/{message_id}/outcome {outcome}` → the updated message.
  404 for an unknown message; 409 when it has no proposal or is already resolved.
- `DELETE /chat` → 204.

Usage is metered as operation `chat`.
Shared helpers move out of `generate.py`: `require_chapter` to `routes/deps.py`, the SSE helpers to `routes/sse.py`, and state assembly to `context.build_chapter_state`.

### Removed

`POST /draft/stream`, `PlanBody`, `drafter_node`, and the drafter's from-scratch branch.
`drafter.py` keeps the revision prompt that `/revise/stream` uses.

## Frontend

### Transport and data

- `api/types.ts`: `ChatMessage`, `ChatProposal`, `ProposalOutcome`.
- `api/endpoints.ts`: `getChat`, `chatStreamUrl`, `resolveProposal`, `clearChat`; `draftStreamUrl` removed.
- `api/stream.ts`: a `proposal_progress` frame and the whole `done` frame passed to `onDone`.
- `hooks/useChat.ts`: the conversation query, `send`, `resolve`, `clear`, and the streaming state (pending user message, reply text, proposal progress, error).
  `send` refuses while streaming; the stream aborts on unmount or document switch.

### Chat pane — `components/ChatPane.tsx`

A right-hand column beside the editor, shown on chapters, collapsible, its open state kept in `localStorage`.
It lists the conversation, streams the reply, and shows each proposal as a card with its status: under review, accepted, discarded, or could not be applied.
The input sends on Enter (Shift+Enter for a newline) and is disabled while AI is busy, while the budget is spent, or while a proposal awaits review, each with a one-line reason.
A Clear button empties the conversation.

### Review in the editor

- `editor/diffWidget.ts`: the diff widget and theme extracted from `rewriteExtension.ts`, extended to render an insertion at an empty range.
- `editor/proposalExtension.ts`: a second overlay field, independent of the rewrite overlay.
- `lib/chat.ts`: `changedSpan(base, proposed)` trims the common prefix and suffix, so the overlay and the accept transaction cover only what changed; `streamingBody(base, mode, text)`; `sha256Hex`; `describeProposal`.
- `components/ProposalLayer.tsx` and `ProposalReviewBar.tsx`: draw the overlay while streaming and reviewing, with Accept, Discard, and a diff toggle; ⌘↵ accepts, Esc discards.
  Accept hashes the editor's text and compares it with `base_hash`.
  A match dispatches one transaction replacing only the changed span, which reaches autosave and undo; a mismatch resolves the proposal as `stale` and leaves the text alone.

The editor is read-only while a chat reply streams and while a proposal is under review, so the base cannot drift in the meantime.

### Workspace integration

- The toolbar loses Generate Draft and gains a Chat toggle.
- The plan panel's Generate Draft → opens the chat and sends "Draft this chapter from the scene plan."
- Chat streaming and a pending proposal fold into `busy`, which disables Plan, Check, Revise, and rewrite.
- Before any request that reads the body or plan server-side (chat, check, revise), the workspace flushes the editor's debounced patch and awaits the save.
  Previously only an in-flight save was awaited, so edits made inside the 800 ms debounce window were missed.

## Error handling

- A 402 or 409 before the stream, an `error` frame, or a network failure shows the message in the pane, drops the pending user message, and puts its text back in the input.
- A truncated reply or a twice-failed edit arrives as an `error` frame.
- A stale proposal is resolved as `stale` with a note in the pane; the text is untouched.

## Testing

### Backend

- `tests/test_chat_agent.py`: `apply_edits` (unique, missing, ambiguous, overlapping, empty find), `build_proposal`, `render_history` (descriptions, outcome notes, cap starting on a user message), prompt contents, and the event stream against a fake SDK stream (text, progress, proposal, edit retry, second failure, truncation, usage per call).
- `tests/test_chat_api.py`: persistence, frames, 409 while pending, outcomes, `proposed_body` dropped on resolve, clear, note → 400, error persists nothing but usage, `chat` usage recorded, deletion removes messages.
- `tests/test_generate_api.py`, `tests/test_drafter.py`: draft-route and from-scratch tests removed; revision tests kept.

### Frontend

- `lib/chat.test.ts`, `api/stream.test.ts`, `editor/proposalExtension.test.ts`.
- `components/ChatPane.test.tsx`, `components/ProposalLayer.test.tsx`.
- `components/ChapterToolbar.test.tsx`, `components/PlanPanel.test.tsx` updated.
- `screens/WorkspaceScreen.test.tsx`: send → stream → review → accept autosaves and records the outcome; stale proposal; Generate Draft from the plan sends a chat message; the debounce-window flush regression.

## Amendments

### 2026-09-13 — Truncated revisions

Moving the revision prompt out of `drafter.py` surfaced a data-loss bug on the unchanged revise path.
`/revise/stream` asked for at most 4,096 output tokens, never checked `stop_reason`, and replaced the whole body with whatever came back, so a revision of a long chapter silently dropped its ending.
The prompt now lives in `agents/reviser.py`, which asks for up to 16,000 tokens and raises `RevisionTruncatedError` on a `max_tokens` stop; the route turns that into an `error` frame and leaves the body untouched.
The route also refuses with 400 when the chapter has no body or no issues, instead of falling through to the removed from-scratch prompt.

### 2026-09-13 — Word diff ceiling

A replace proposal for a long chapter can differ from the old text almost everywhere, and an unbounded word diff over it can stall the page.
`wordDiff` caps the edit distance it explores and, past the cap, shows the old passage as removed and the new one as added.
