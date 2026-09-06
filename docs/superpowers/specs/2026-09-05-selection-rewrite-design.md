# Selection Rewrite — Design

**Date:** 2026-09-05
**Status:** Approved (pending implementation plan)
**Supersedes:** the June 2026 design on the `worktree-selection-rewrite` branch, which targeted the pre-workspace chapter UI.

## Summary

While editing a chapter, the writer selects a span of prose, types an instruction such as "make this more tense", and the model rewrites only that span.
The suggestion streams into the document in place of the selection, then shows as an inline word-level diff with Accept, Discard, and Try again controls.
Nothing outside the selection changes, and nothing is persisted until the writer accepts.
This is the inline-edit pattern familiar from coding editors and Notion's ⌘K.

## Goals

- Rewrite a selected span from a free-text instruction, keeping every other character of the chapter identical.
- Keep rewrites in the project's voice by giving the model the story bible, as the drafter already does.
- Review the suggestion in place, inside the real document, before it lands.
- Accept through the normal editing path so the change autosaves and is undoable.

## Non-goals

- Rewrite on the story bible or notes.
  The rewriter prompt is tuned for fiction and reads the bible as context, so it does not fit reference documents.
- Multiple simultaneous rewrites, or batch rewrites across a chapter.
- Rich text.
  The body stays a plain string with newlines; the new editor renders plain text only.

## Decisions

| Question | Decision |
|---|---|
| Editor foundation | CodeMirror 6 styled as prose, replacing the `<textarea>` for every document kind |
| Scope | Chapter documents only; the rewrite extension is not installed on bible or note editors |
| Model context | Story bible, the instruction, the selection, and bounded before/after context windows |
| Delivery | Stream the replacement into place, then show the diff on completion |
| Prompt placement | Floating card anchored below the selection, opened from a pill or ⌘K |
| Review | Inline word-level diff in the document, with a bar offering Accept / Discard / Try again |
| Persistence | Accept applies an editor change; the existing autosave persists it. The endpoint writes nothing |

## Core mechanic and guarantee

On submit, the model receives only the selected span plus read-only context, and returns only its replacement.
The client assembles the new chapter text as `before + replacement + after`, where `before` and `after` are the exact substrings around the selection in the editor's document.
The model never emits the surrounding prose, so the rest of the chapter is preserved byte-for-byte by construction rather than by trusting the model.

The reply is trimmed of leading and trailing whitespace, then given the original selection's leading and trailing whitespace.
A selection that ended in a paragraph break still ends in one after the rewrite.

## Backend

### New agent — `backend/agents/rewriter.py`

Mirrors `drafter.py` in structure and exports two functions.

- `_build_rewrite_messages(state) -> tuple[str, str]`
  - The system prompt says the model is rewriting a passage of literary fiction, embeds the full story bible text under a `STORY BIBLE:` heading exactly as the drafter does, and instructs it to rewrite only the passage, follow the instruction, and emit only the replacement prose with no commentary, meta-text, or titles.
  - The user content carries `INSTRUCTION`, `CONTEXT BEFORE (do not rewrite)`, `PASSAGE TO REWRITE`, and `CONTEXT AFTER (do not rewrite)` sections.
- `rewriter_token_stream(state) -> AsyncIterator[str]`
  - Streams text deltas from `client.messages.stream(...)`, same model, `max_tokens`, and temperature as the drafter.
  - Owns the API call only; SSE framing is the endpoint's job.

The state dict carries `story_bible`, `instruction`, `selection`, `before`, and `after`.

### New endpoint — `backend/routes/generate.py`

```
POST /projects/{project_id}/documents/{document_id}/rewrite/stream
```

Request body, a Pydantic model `RewriteBody`:

```python
class RewriteBody(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    selection: str = Field(min_length=1, max_length=20000)
    before: str = Field(default="", max_length=4000)
    after: str = Field(default="", max_length=4000)
```

- Auth and ownership through `require_project`; chapter-only through `_require_chapter`.
- Loads the bible with `get_bible_body`; does not build previous summaries, since the surrounding prose is the relevant context and summaries would add model calls.
- Streams `delta` frames, then a `done` frame whose `body` field is the completed replacement, using the existing `_sse` helper and `_SSE_HEADERS`.
- An exception inside the generator becomes an `error` frame, as in the draft and revise endpoints.
- Persists nothing and never touches `document.body` or `summary_hash`.

The `done` frame keeps the field name `body` so the frontend's single SSE parser is unchanged.
For this endpoint the field means "the completed text of this stream", which the caller knows is a replacement span.

## Frontend

### Dependencies

- `@codemirror/state`, `@codemirror/view`, `@codemirror/commands` for the editor, history, and default keymap.
- `diff` (jsdiff) for the word-level diff.

### ProseEditor — `frontend/src/components/ProseEditor.tsx`

A React wrapper around a CodeMirror `EditorView`, used by `DocumentEditor` for every document kind.

- Props: `value`, `onChange(text)`, `readOnly`, `ariaLabel`, and `extensions` for optional additions such as the rewrite extension.
- Creates the view once on mount with line wrapping, history, the default keymap, spellcheck enabled on the content element, and a theme: serif type at 15px with 1.8 leading, 24px horizontal padding, white background, no gutters, no active-line highlight.
- When `value` differs from the view's document, dispatches a whole-document replacement.
  This is how the streaming `bodyOverride` reaches the editor during draft generation.
- `readOnly` is applied through a reconfigurable compartment so it can flip without recreating the view.
- Calls `onChange` on every user edit with the full document text, which feeds the existing debounced autosave unchanged.

`DocumentEditor` keeps its title and brief inputs, its debounce, and its flush-on-unmount behaviour.
It swaps the textarea for `ProseEditor` and, on chapters, passes the rewrite extension.

### Pure helpers — `frontend/src/lib/rewrite.ts`

No React, no network.

- `spliceText(text, range, replacement)` replaces `[start, end)`.
- `contextWindows(text, range, beforeMax = 1500, afterMax = 500)` returns `{ before, selection, after }`.
- `matchEdgeWhitespace(original, replacement)` trims the replacement and copies the original's leading and trailing whitespace onto it.
- `wordDiff(oldText, newText)` wraps `diffWords` into `{ value, added, removed }` parts.

### State machine — `frontend/src/hooks/useSelectionRewrite.ts`

A reducer, exported for tests, plus a hook that drives the stream.

```
idle → prompting → streaming → reviewing → idle
```

State: `phase`, `range`, `instruction`, `replacement`, `error`.

Actions:

- `open(range)` from idle or prompting.
- `submit(instruction)` from prompting; starts the stream with an `AbortController`.
- `delta(text)` appends during streaming.
- `done(text)` moves to reviewing with the whitespace-matched replacement.
- `error(message)` moves to reviewing with `error` set and an empty replacement.
- `retry()` returns to prompting with the previous instruction kept.
- `cancel()` aborts an in-flight stream and returns to idle.

`streamPost` in `api/stream.ts` gains an optional `signal` so the hook can abort.
An aborted request resolves silently rather than surfacing as an error.

### Editor extension — `frontend/src/editor/rewriteExtension.ts`

A CodeMirror extension that renders the rewrite state inside the document without modifying it.

- Prompting: a mark decoration tints the selected range.
- Streaming: a replace decoration hides the original range behind a widget showing the streamed text in an accent tint with a shimmering caret.
- Reviewing: the same widget renders the word-level diff, removed words struck through in muted rose and added words in green, or the clean result when the writer toggles the diff off.
- Reviewing with an error: the original range is shown with the prompting tint and no diff, so the writer sees exactly what Retry will act on.
- The extension also exposes the selection rectangle for anchoring the floating cards, via `coordsAtPos`, with a fallback position when layout is unavailable.
- Accept dispatches one transaction replacing the range with the replacement.
  It goes through the view, so it reaches `onChange`, autosave, and undo history.
- Discard clears the decorations and leaves the document untouched.

The editor is read-only while streaming or reviewing.

### Floating UI

- **Selection pill** — `✦ Rewrite  ⌘K`, shown just above a non-empty selection on a chapter.
  Click or ⌘K (Ctrl+K on other platforms) opens the prompt.
- **RewritePrompt** — `frontend/src/components/RewritePrompt.tsx`.
  A card anchored below the selection: a single-line input with placeholder text such as "make this more tense", three preset chips (Tighten, More tension, Show, don't tell) that fill the input, and a send button.
  ⌘↵ submits, Esc closes.
  Reopened by Try again with the previous instruction in the input.
- **RewriteReviewBar** — `frontend/src/components/RewriteReviewBar.tsx`.
  A bar anchored below the reviewed span with `✓ Accept`, `✕ Discard`, `↻ Try again`, and a diff/result toggle.
  Enter or ⌘↵ accepts, Esc discards.
  In the error state it shows the message with Retry and Discard.

Both cards use the same visual language: white surface, a soft shadow, a hairline border, small type, and one accent colour shared with the tinted selection and the streamed text.

### Integration — `WorkspaceScreen` and `DocumentEditor`

- `DocumentEditor` gains `projectId` and `onBusyChange(boolean)` props.
  It reports true while a rewrite is streaming or under review, and `WorkspaceScreen` folds that into `busy` so the toolbar's generation buttons disable.
- While a draft or revision streams, the editor is read-only and the rewrite pill does not appear.
- Switching documents or a finished generation remounts the editor, as today; the hook aborts any in-flight rewrite on unmount.

## Error handling

- An SSE `error` frame, a network failure, or an empty reply moves the flow to reviewing with `error` set.
  The review bar shows the message with Retry and Discard.
  The document is not modified.
- Discard during streaming aborts the request.
- Unmount aborts the request and drops the overlay.

## Testing

### Backend

- `tests/test_rewriter.py`: the system prompt contains the bible text; the user content contains the instruction, the selection, and both context windows; the stream yields the mocked deltas.
- `tests/test_generate_api.py`: the endpoint streams `delta` and `done` frames with a mocked `rewriter_token_stream`; the document body is unchanged afterwards; a bible document returns 400; an empty instruction or selection returns 422.

### Frontend

- `lib/rewrite.test.ts`: splice invariant, context window bounds, edge whitespace matching, and diff parts.
- `hooks/useSelectionRewrite.test.ts`: reducer transitions for open, submit, delta, done, error, retry, and cancel.
- `components/ProseEditor.test.tsx`: renders the value, calls `onChange` with the full text on edit, honours `readOnly`, and follows an external `value` change.
- `components/DocumentEditor.test.tsx`: existing tests pass against the new editor.
- `components/RewriteFlow.test.tsx`: with an msw-mocked SSE endpoint, selecting text and submitting an instruction streams a suggestion, Accept yields the spliced text through `onChange`, and Discard leaves it unchanged.

## Touched files

- New: `backend/agents/rewriter.py`, `tests/test_rewriter.py`
- Edit: `backend/routes/generate.py`, `tests/test_generate_api.py`
- New: `frontend/src/components/ProseEditor.tsx`, `RewritePrompt.tsx`, `RewriteReviewBar.tsx`, `frontend/src/editor/rewriteExtension.ts`, `frontend/src/hooks/useSelectionRewrite.ts`, `frontend/src/lib/rewrite.ts`, and their tests
- Edit: `frontend/src/components/DocumentEditor.tsx`, `frontend/src/screens/WorkspaceScreen.tsx`, `frontend/src/api/endpoints.ts`, `frontend/src/api/stream.ts`, `frontend/package.json`

## Amendments

### 2026-09-06 — Truncated replies

The `selection` limit of 20 000 characters can exceed what a 4096-token reply can hold.
Rather than lowering the limit, the rewriter inspects the final message's `stop_reason`.
When it is `max_tokens`, the agent raises `RewriteTruncatedError` and the endpoint emits an `error` frame asking the writer to select a shorter passage.
The document is never modified, and the review bar shows the message with Retry and Discard.

### 2026-09-06 — Context echo guard

A live rewrite continued into the after-context, so accepting it duplicated prose.
The system prompt now states that the reply must begin where the passage begins and end where it ends.
The client additionally strips a leading echo of the before-context or a trailing echo of the after-context of at least 24 characters, keeping the reply non-empty, before the edge whitespace is matched.

### 2026-09-06 — Document changes during review

Accept re-validates that the range still holds the original selection, and the layer abandons a streaming or reviewing rewrite when any document change other than Accept itself reaches the editor.
