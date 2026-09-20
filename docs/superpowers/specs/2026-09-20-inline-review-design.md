# Inline review: specialist agents in the chat, localized fixes in the prose

## The problem

"Check" is a dead end.
It runs one model call, writes a list of issues to `Document.issues`, and shows them in a panel tab under the editor.
The writer reads a finding, looks back at the prose, finds the passage themselves, and fixes it by hand — or presses "Revise Draft", which throws the whole chapter at the model and replaces it wholesale.
There is no way to take one finding and leave another.

Meanwhile the chapter chat already does the thing Check should do: it proposes a change, draws it in the prose, and waits for Accept or Discard.
It is just limited to one proposal per reply, resolved all at once.

## What this builds

Check disappears.
In its place, the chat composer grows a `+` button listing **specialist agents**; the first is **Continuity check**.
Running one is a chat turn like any other.
Its reply carries not one proposal but a **set of localized suggestions**, each drawn in the prose where it applies, each with a one-line explanation of what the agent found, and each accepted or discarded on its own.

The same applies to ordinary chat edits: asking "tighten the second paragraph" now yields suggestions with explanations, reviewed one by one.
There is one review model in the editor, not two.

## Decisions

| Question | Decision |
|---|---|
| Per-suggestion review for all chat edits, or specialists only? | All. `edit_draft` becomes `suggest_fixes`; one proposal kind, one overlay. |
| Specialists in v1 | Continuity check only. The registry is built for many. |
| Where the explanation appears | An inline card anchored under the changed span: severity dot, one line, ✓ / ✕. Not a mirrored list in the chat. |
| While suggestions are pending | The prose is read-only and the chat input is disabled, as today. Accept all / Discard all clear the set. |
| Old machinery | Deleted: the Check button, `POST …/check`, `checker.py`, `reviser.py`, `POST …/revise/stream`, `IssuesList`, `IssueCard`, PlanPanel's Issues tab, the `Issue` type, and the `documents.issues` column. |

## Architecture

### The proposal contract

`ChatMessage.proposal` is a JSON column holding one of two kinds.
`write` is unchanged — a whole new body, one outcome.
`suggestions` is new:

```jsonc
{
  "kind": "suggestions",
  "base_hash": "<sha256 of the body this was computed against>",
  "suggestions": [
    {
      "find": "her blonde hair",        // exact, unique in the base body
      "replace": "her dark hair",
      "explanation": "The bible gives Mara dark hair.",
      "severity": "critical",           // null for ordinary chat edits
      "from": 412, "to": 427,           // offsets into the base body
      "outcome": null                   // accepted | discarded | stale
    }
  ]
}
```

The outcome moves from the proposal to the individual suggestion.
This is the change that ripples: `has_pending_proposal`, `resolve_proposal`, `describe_proposal` and the outcome note all become set-aware.

Offsets are resolved server-side by the same validation that already guards `edit_draft`: each `find` must be non-empty, occur exactly once, and not overlap another.
Every problem in a set is reported at once and the model gets one correction attempt, as today.
Sending offsets rather than a whole `proposed_body` is what makes N independent suggestions possible at all.

### The reviewer registry

`backend/agents/reviewers.py` holds a `Reviewer` — key, label, hint, the message that appears in the chat, a system prompt, and what it renders into the user turn — plus `REVIEWERS`, keyed by slug.
A reviewer is a forced call to the shared `suggest_fixes` tool: the domain lives in the prompt, not in a bespoke tool schema, so a second specialist is one dataclass instance and a prompt.

`GET /agents` serves the registry to the picker, the way `GET /me` already serves the model catalogue — labels live in one place.

### One streaming turn, two callers

The retry-on-bad-proposal loop, the SSE event types, and usage reporting are factored into `stream_turn(system, messages, tools, tool_choice, body, …)` in `agents/chat.py`.
`chat_event_stream` is that plus the conversational prompt and `tool_choice: auto`; a reviewer run is that plus its own system prompt and a forced tool.
`POST …/chat/stream` takes an optional `agent`; with it set, the stored user message is the reviewer's canonical message and `ChatMessage.agent` records which specialist ran.

### Review in the editor

`proposalExtension` holds a list of spans instead of one.
Each unresolved suggestion is a `Decoration.replace` over its span rendering a `SuggestionWidget`: the word diff inline, and beneath it a card with the severity dot, the explanation, and ✓ / ✕.
Callbacks reach the widget through the same `host.current` box `rewriteExtension` already uses, so no React renders inside CodeMirror.

Accepting one suggestion splices only its span.
The remaining spans shift by the length delta, computed by a pure `shiftSpans` in `lib/chat.ts` and re-dispatched in the same transaction as the change — so there is no frame where the overlay points at stale offsets.
Before each splice the layer checks that the span still reads as `find`; a mismatch resolves that suggestion `stale` instead of corrupting the text.
On mount, a body whose hash differs from `base_hash` marks the whole set stale, preserving today's guarantee.

## Testing

- `resolve_spans` / `build_proposal`: offsets, duplicate and missing `find`, overlap, all problems reported together.
- `describe_proposal` and the outcome note with a partly-accepted set — including that an assistant message renders identically before and after resolution, which is what keeps the prompt prefix cacheable.
- `shiftSpans`: a span before, after and adjacent to an accepted one.
- Reviewer run end to end against a stubbed client: forced tool, suggestions stored with `severity`, `agent` recorded, usage metered as `review`.
- `POST …/messages/{id}/outcome` with one index, with a list, and with none (all unresolved); rejection once the set is fully resolved.
- Editor: accepting the second of three suggestions leaves the other two correctly positioned; a `find` that no longer matches goes stale; Discard all clears the set without touching the text.

## Out of scope

Re-anchoring suggestions through free typing (the writer's prose is read-only while a set is pending).
A chat-side mirrored list of findings.
Specialists beyond continuity.

## Amendments from implementation

Four things the design did not anticipate, all found by running the feature rather than by testing it.

**A reviewer needs its own copy of the tool schema.**
Told that `severity` was available, Haiku left it out of every fix, and the cards came back with no dot and no colour.
`suggest_tool(rate_severity=True)` makes it required for a review pass; the chat's copy still does not ask, because how serious a line edit is would be noise.

**A fix whose `replace` equals its `find` is refused.**
The model used one as a way to remark on a passage it was not changing.
It draws an empty diff and asks the writer to accept a no-op, so it is now a validation error like any other, and the model gets its one correction attempt.

**`.env` is loaded by the `backend` package, not by `backend.settings`.**
Several agent modules build their Anthropic client at import time.
Adding `from backend.agents.reviewers import …` to `main.py` put an agent ahead of settings in the import order, and every generation then failed at request time with "Could not resolve authentication method".
`backend/__init__.py` now owns `load_dotenv()`, and `tests/test_env_loading.py` imports an agent first, in a subprocess, to keep it that way.

**The draft-stream machinery went with Revise.**
`useDraftStream`, `streamBody` and the editor's `docVersion` remount key existed only for a route that rewrote the body server-side.
Nothing does that any more — every AI change to a chapter now arrives as a proposal the writer applies from inside the editor — so they are gone.
