# Chapter summary view

## Why

Every AI call on a chapter reads the preceding chapters as summaries, not as their full text.
The writer never sees those summaries, so they cannot tell what the AI remembers, and they cannot correct it when it remembers wrong.
A wrong summary silently produces a wrong plan, a wrong draft, or a false continuity finding.

This change makes each chapter's summary visible and editable, and says plainly, where the writer works, that the summaries are what the AI reads.

### Is summarizing still the right call?

Yes.
Context windows are no longer the binding constraint, but cost, latency, and attention still are: every chat turn resends its context, and ten full prior chapters would multiply each turn's input many times over while burying the few facts that matter.
The summary is also the story's continuity record, which is worth exposing on its own merits.

Known gap, out of scope here: the summarizer omits prose style, and the chat (which drafts) reads only the previous chapter's summary, so a draft does not see how the previous chapter sounded or ended.
A follow-up could add the previous chapter's closing paragraphs verbatim.

## What each agent reads today (unchanged by this work)

`build_previous_summaries` returns the summaries of the up-to-10 (`MAX_PRIOR_CHAPTERS`) non-empty chapter documents before the current one.

- The planner and the continuity check read all of them.
- The chat reads only the last one.

The UI shows exactly this; it does not change what any agent reads.

## Data model

Add `documents.summary_edited: bool`, not null, default false (Alembic migration).

`summary_hash` keeps its meaning: the hash of the body the summary describes.
When the writer saves a summary, the server stores it with `summary_edited = true` and `summary_hash = body_hash(body)`, so a later body edit is still detectable.

A derived `summary_status`, computed server-side from those three columns and the body:

| status | condition | shown as |
| --- | --- | --- |
| `empty` | body is empty | "Empty chapters are not summarized." |
| `missing` | no summary yet | "Not summarized yet. It will be written the first time a later chapter uses the AI." |
| `current` | not edited, hash matches body | "Up to date" |
| `stale` | not edited, hash does not match | "Out of date. Refreshes on the next AI request that reads it." |
| `edited` | edited, hash matches body | "Edited by you" |
| `edited_stale` | edited, hash does not match | "Edited by you. The chapter has changed since; regenerate if it no longer holds." |

## Summary lifecycle

- `build_previous_summaries` never regenerates an edited summary, stale or not; it uses the writer's text as is.
- Saving an empty summary reverts to automatic: `summary = null`, `summary_edited = false`.
- Regenerating (the new endpoint) replaces the text and clears `summary_edited`.
- The prompt labels (`Chapter {i + 1} summary`) in the planner and continuity check number from the start of the window, which is wrong past ten chapters; they switch to the document's title, which is what the writer sees in the sidebar.
  `build_previous_summaries` returns `(title, summary)` pairs for this.

## API

- The document detail response adds `summary`, `summary_status`.
- `PATCH /projects/{pid}/documents/{id}` accepts `summary`, applying the lifecycle rules above.
- `POST /projects/{pid}/documents/{id}/summary` summarizes the chapter now and returns the detail.
  It checks the AI budget and meters the call as `summarize`, like the implicit refreshes.
  It is refused with 400 for a non-chapter or an empty chapter.
- `GET /projects/{pid}/documents/{id}/summary-context` returns the prior chapters this chapter's AI calls read, in order, as `{id, title, summary_status}`.
  It shares the window query (`prior_chapter_documents`) with `build_previous_summaries` and summarizes nothing, so looking costs nothing.

## UI

### Summary tab

A third tab beside Write and Plan in `ChapterToolbar`.

- A lead line: "What the AI remembers of this chapter. Later chapters are written from this summary, not from the full text."
- A second line: "Read by the next chapter's chat, and by planning and continuity checks for up to the next ten chapters."
- The summary as an auto-growing textarea, saved on the same debounce as the chapter context.
- A status line from `summary_status`, with the wording in the table above.
- A **Summarize now** button when `missing` or `stale`, **Regenerate** when `current`, `edited`, or `edited_stale`; regenerating an edited summary asks for confirmation first, since it discards the writer's text.
  Disabled for `empty`, and while any generation is running.

### Context line in the Write view

Under the chapter context, one quiet line naming what the AI reads beyond this chapter:

"The AI reads the story bible and summaries of: Ch. A, Ch. B, … (the chat reads only Ch. B's)."

Each title links to that chapter's Summary tab.
A summary that is `missing` or `stale` is marked, since the next request will pay to refresh it.
On a first chapter the line reads "The AI reads the story bible. No earlier chapters to summarize."

## Testing

- Backend: status derivation; an edited summary survives a body edit and is not regenerated by `build_previous_summaries`; empty save reverts; the summarize endpoint meters and refuses empty chapters; the context endpoint's window matches `build_previous_summaries`; prompt labels use titles.
- Frontend: the Summary tab renders each status and its action, saves edits, and confirms before regenerating an edit; the context line lists and links the right chapters.
- End to end in the browser against `make dev`: write two chapters, open chapter 2, see chapter 1 in the context line, open its Summary tab, summarize, edit, change chapter 1's body, and confirm the edit survives a chat turn on chapter 2.
