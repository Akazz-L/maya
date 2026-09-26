# The agent context model

What each agent is given of the story so far, and why.

## Why

Maya's context rules grew one agent at a time and never as a whole.
Today the drafting chat reads one chapter back, the planner and the continuity check read ten, and the selection rewrite reads none.
Nothing reads a sentence the author wrote beyond the chapter open in front of them, because the summarizer is told to discard prose style.
The ten-chapter cap is not a memory decision at all: it is a guard against the first request on chapter 30 firing 29 summarizer calls at once (`backend/context.py:14`).

The result is an assistant that drafts without knowing how the last chapter sounded, forgets the opening of its own book, and checks continuity against a window that slides away from the facts most likely to be contradicted.

This design replaces the per-agent accidents with one model: **compress facts, sample voice, and keep what the writer can correct visible.**

## Measured baseline

Counted with `messages.count_tokens` (Haiku 4.5 tokenizer) against the seeded demo project on 2026-09-25.

| Component | Words | Tokens |
| --- | --- | --- |
| Chat system rules | — | 332 |
| Story Bible (demo, short) | 304 | 476 |
| Chapter body, "The Weighing House" | 350 | 470 |
| Its summary | — | 194 |
| Chapter body, "Salt and Silver" | 569 | 753 |
| Its summary | — | 211 |
| Scene plan (rendered) | — | 310 |

Prose runs about **1.33 tokens per word**.
The demo's chapters are short, so their summaries look large next to them; the summarizer's `max_tokens=512` means a full-length chapter of ~3,000 words (~4,000 tokens) compresses roughly **10:1**, to 350–500 tokens.
Every projection below uses a 4,000-token chapter and a 350-token summary.

## The cost argument

Three facts decide the design.

**The context window is not the constraint.**
Opus 5 and Sonnet 5 hold 1M tokens; Haiku 4.5 holds 200K.
A 100,000-word novel is about 133,000 tokens, so most of a book would fit.

**The monthly budget is the constraint.**
`MONTHLY_BUDGET_USD` defaults to $5 per writer per month.
A 40-chapter novel is ~160,000 tokens of prose, which is $0.16 per chat turn on Haiku and $0.80 on Opus.
Sending the whole book on every turn spends the month in six messages on Opus.

**Caching does not rescue full prose, because of how writing feels.**
Cached reads cost a tenth of input, but the default cache lifetime is five minutes and a writer pauses to reread, to think, to edit by hand.
Most turns would land after expiry and pay a cache *write* at 1.25x instead.
Prefix caching is also byte-exact: fixing a typo in chapter 3 invalidates every cached token after it.
In a tool whose purpose is editing earlier text, a novel-sized cached prefix thrashes by design.
Summaries do not: editing chapter 3 re-summarizes chapter 3 and nothing else.

The conclusion is not "summaries are cheaper".
It is that **the context must be made of pieces that change at different rates**, so an edit invalidates the smallest possible part of it.

## Principles

A drafting agent needs three different things from the story so far, and one artifact cannot carry all three.

| Need | Right form | Cost |
| --- | --- | --- |
| **Facts** — who knows what, where they are, the timeline | Compression: summaries, folded into a digest | One model call per chapter, ever |
| **Voice** — how the prose sounds, how the last chapter ended | Sampling: real sentences, verbatim | None; it is a substring |
| **Intent** — what this chapter is for | The writer's own: chapter notes, scene plan | None |

Compression is lossy in exactly the way that serves continuity and harms prose.
Sampling is lossy in the opposite way.
Maya currently does only the first, which is why the drafter is the weakest-served agent in the app.

Two further rules, carried over from the chapter summary work:

- **If the AI reads it, the writer can see and correct it.** Derived memory is offered as a default, never as a fact.
- **A writer's correction is never overwritten automatically.** It is replaced only when they ask.

## The model

### Layers

Every chapter request is assembled from five layers, ordered by how often each changes, so the cache prefix survives as much editing as possible.

| # | Layer | Changes when | Cached |
| --- | --- | --- | --- |
| 1 | System rules + Story Bible | The writer edits the bible | Yes, 1h TTL |
| 2 | Story so far (digest of everything before the window) | A chapter leaves the window | Yes, 1h TTL |
| 3 | Recent chapter summaries (the nearest 5) | A recent chapter is edited | Yes, 1h TTL |
| 4 | Voice sample: previous chapter's closing prose | The previous chapter's ending is edited | Yes |
| 5 | Chapter notes, scene plan, chapter text, the writer's message | Every turn | No |

Four cache breakpoints is the API maximum, which is exactly what layers 1–4 need.
Layer 5 sits after the last breakpoint.

**The window is five chapters, for every agent.**
Today it is ten, and ten exists only because nothing older was kept at all.
Once the digest holds everything before the window, the window's job is narrower: the recent chapters whose detail still matters for what happens next.
Five at ~350 tokens each, against a digest capped at ~800, is the split this design proposes; it is a number to tune against real projects, not a constant to defend.

### What each agent gets

| Agent | Bible | Digest | Summaries | Voice sample | Chapter text |
| --- | --- | --- | --- | --- | --- |
| **Chat (drafts, continuations, edits)** | Full | Yes | Nearest 5 | Previous chapter's last ~400 words | Full |
| **Planner** | Full | Yes | Nearest 5 | No | — |
| **Continuity check** | Full | Yes | Nearest 5 | No | Full |
| **Selection rewrite (⌘K)** | Full | No | No | No | Full chapter + scene plan |
| **Summarizer** | No | No | No | No | The one chapter |

Every agent that reads the story so far now reads the same thing.
That is the point of the table: three agents drifting apart is what produced today's behaviour, where the same chat pane remembers one chapter or ten depending on which button was pressed.

The rewrite keeps no long-range memory on purpose: it is a local operation on a passage.
It gains the chapter's whole text and its plan, replacing today's ±4,000 characters around the selection, which is why it can currently only manage tonal changes.

### Adaptive prose mode

While the prior chapters of a project total **20,000 tokens or fewer**, the agents receive their prose verbatim instead of the digest and summaries.
(The design said "the chat"; it applies to every agent, because a planner reading two real chapters is better informed than one reading two summaries, and because it means a new project never pays a summarizer call at all.)
That is about five full chapters, or fifteen short ones — the stretch where the voice is being established and where imitating real sentences matters most.
Cost at the ceiling is about $0.02 per turn on Haiku and $0.10 on Opus, against a prefix that caches well because early chapters are edited less than the one being written.

The threshold is measured locally from body lengths (words × 1.33), never with an API call.
Crossing it is silent to the writer except in the Write view's context line, which says which mode is in force.

### Projected cost

A chat turn on chapter 41 of a 40-chapter novel, in tokens:

| | Today | Proposed |
| --- | --- | --- |
| Rules + bible | 1,800 | 1,800 |
| Digest | — | 800 |
| Summaries | 350 (one) | 1,750 (five) |
| Voice sample | — | 530 |
| Plan + notes + chapter | 4,500 | 4,500 |
| **Total** | **~6,650** | **~9,380** |
| Of which cacheable | 1,800 | 4,880 |

Cost follows from where those tokens sit, not from how many there are.
Billing the cacheable part at a tenth when the cache is warm and at 1.25x when it is cold, on Haiku at $1/MTok:

| | Warm turn | Cold turn |
| --- | --- | --- |
| Today | $0.0050 | $0.0071 |
| Proposed | $0.0050 | $0.0106 |
| Full prose, always | $0.0207 | $0.2067 |

A warm proposed turn costs the same as today, because the summaries move out of the re-billed tail and into a cached layer: five summaries read from cache cost less than one summary re-sent every turn.
A cold turn costs about 50% more, which is the price of a larger prefix to write.
Full prose at the same point in the book is 4x the proposed cost warm and 20x cold — and cold is the common case in real writing rhythm, which is the whole argument.

The bible is assumed at ~1,500 tokens, larger than the demo's 476, since a real one carries a full cast.

## Data model

### Story digest

**Changed during implementation.** The design called for one digest per project, in a `story_digests` table.
That is wrong, and building it showed why: the digest is a *prefix*.
What the AI should remember while you write chapter 30 is not what it should remember while you revise chapter 6 — a single project-level row would hand chapter 6's draft everything that happens after it.

So the digest is held **per chapter**, on `documents`: `digest`, `digest_hash`, `digest_edited`, mirroring the summary columns beside them.
Each chapter's digest covers exactly the chapters before its own window, which also makes folding natural: the next chapter's digest is this one's plus one more chapter.

| Column | Meaning |
| --- | --- |
| `digest` | The record of everything before this chapter's window |
| `digest_hash` | Hash of the ordered `(document_id, summary_hash)` pairs it was folded from; detects a changed, reordered or deleted source |
| `digest_edited` | The writer wrote this text; never regenerated automatically |

Status is derived exactly as `summary_status` is, with the same vocabulary — `missing`, `current`, `stale`, `edited`, `edited_stale` — so one explanation covers both surfaces.

### Folding

- **Normal path.** When a chapter leaves the recent window, its summary is folded into the digest: one model call taking the current digest plus that one summary, returning the new digest. One call per chapter, once in its life.
  It runs inside `build_chapter_state`, alongside the summary refresh it already does, and is metered as `digest` through the same `on_usage` callback — the writer sees every implicit call in the meter.
- **Rebuild.** When an already-folded chapter is edited, reordered, or deleted, `source_hash` no longer matches and the digest is rebuilt in **a single call** over all folded summaries — not one call per chapter. Summaries are ~350 tokens, so 40 of them is ~14,000 tokens: one cheap call, not forty.
- **Never on an edited digest.** As with summaries, an edited digest is used as it stands and the view says the story has moved on.
- The digest is capped by prompt instruction at ~800 tokens and is organized under fixed headings: who is where, what each character knows, unresolved threads, timeline.

### Backfill and the burst

`build_previous_summaries` currently fans out over every stale chapter with an unbounded `asyncio.gather`.
On an imported novel that is 29 simultaneous calls and a likely 429.

- Summarizer fan-out runs under a semaphore of **4**.
- Before a fan-out larger than **5 chapters**, the request is refused with a 409 naming the number of chapters to be summarized and its estimated cost, and the writer starts it explicitly from the Story so far view. A budget check runs against that estimate first, rather than discovering the overspend afterwards.
- `MAX_PRIOR_CHAPTERS` is deleted. The window becomes "the nearest 5 summarized"; everything older lives in the digest, so nothing is forgotten outright.

### Voice sample

The previous chapter's closing prose, taken as a substring: the last paragraphs up to ~400 words, cut at a paragraph boundary, never mid-sentence.
No column, no model call, no cache of its own — it is computed from the body already loaded.
It is not stored, so it can never go stale.

## UI

### Story so far

**Changed during implementation**, following the data model above: the record belongs to a chapter, so it is shown on that chapter rather than at project level.
The Summary tab becomes **Memory** and holds both halves of the same question — what the AI remembers arriving here, and what it will remember of here.
The story so far sits beneath the chapter's own summary:

- The lead line: "What the AI remembers of the chapters before the recent ones. It reads this in place of them."
- The digest as editable text, with the same status vocabulary and the same rule that an edit is never overwritten.
- **Rebuild** (confirmed when the digest is edited), and the chapter range it covers: "Chapters 1–35."
- The place a large backfill is started. When chapters are waiting to be summarized — an imported novel, or a project that has never generated — **Write it now** summarizes them and folds the record. This is what the 409 above points at, so a first generation never silently spends a third of the month.
- When a project has fewer chapters than the window, the view says so and offers nothing to build.

### Write view context line

The existing line gains the two new sources and says which mode is in force:

- Windowed: "The AI reads the story bible, *Story so far* (ch. 1–35), summaries of \<5 chapters>, the end of \<previous chapter>, and this chapter."
- Prose mode: "The project is short, so the AI reads your earlier chapters in full."

Each name opens the thing it names.

## Phases

Each phase ships on its own and is worth shipping alone.

**Phase 1 — Voice sample.**
The previous chapter's closing prose reaches the chat, verbatim.
No migration, no new endpoint, no model call.
The largest quality gain in the design and the cheapest thing in it.

**Phase 2 — One window, cached.**
The chat reads the same summary window as the planner and the continuity check.
Summaries, digest and voice sample move into cached blocks with a 1h TTL, ordered by change rate.
Cache effectiveness is asserted in tests through `usage.cache_read_input_tokens`, and the stale comment at `backend/llm.py:11` (which claims nothing caches) is corrected.

**Phase 3 — Story so far.**
The digest, its columns, its folding, its view, and the removal of `MAX_PRIOR_CHAPTERS`.
Includes the semaphore and the large-backfill confirmation.

**Phase 4 — Adaptive prose mode.**
Under 20,000 tokens of prior prose, the chat reads chapters instead of summaries.

## Testing

- **Unit.** Voice sample cuts on a paragraph boundary and never exceeds its cap; digest status derivation; folding is incremental on the normal path and single-call on rebuild; `source_hash` catches an edit, a reorder and a deletion; an edited digest is never regenerated; the semaphore bounds concurrency; the large-backfill refusal fires at the threshold and names the cost.
- **Prompt assembly.** Each agent receives exactly the layers in the table above — asserted per agent, since the point of this work is that they stop drifting apart.
- **Caching.** A second identical turn reports non-zero `cache_read_input_tokens`; editing the open chapter does not invalidate layers 1–4; editing the bible does.
- **Frontend.** The Story so far view renders each status and its action; the context line names the right sources in each mode.
- **End to end.** A seeded 12-chapter project: confirm the digest covers 1–7, that a chat turn carries the digest, five summaries and the voice sample, that editing chapter 2 marks the digest stale without destroying an edit to it, and that a short project uses prose mode.

## What this does not do

- **No retrieval.** A "find the passage that mentions X" tool would answer long-range questions better than any digest. It is a larger build and only pays off past the size where the digest starts to blur; revisit once the digest exists and can be judged.
- **No automatic Story Bible proposals.** Having the AI suggest bible entries after an accepted chapter is the right long-term home for durable facts, and is deliberately a separate design.
- **No prompt evaluation harness.** Phases 1, 2 and 4 change what the drafting model sees, and nothing here proves the prose gets better; it argues that it should. A small eval over a handful of chapters would settle it and is the natural follow-on.
