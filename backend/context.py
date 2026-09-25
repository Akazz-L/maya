"""What each agent is given of the story so far.

One assembler, so the planner, the chat and the review passes cannot drift into
remembering different amounts — which is what they had done. The model has
three parts, because a drafter needs three different things from earlier
chapters and no single artifact carries all three:

- facts, compressed: the summary window, and the digest of everything older;
- voice, sampled: the previous chapter's closing prose, verbatim;
- intent, as written: the chapter's own notes and scene plan.

Compression is lossy in the way that serves continuity and hurts prose; a
sample is lossy in the opposite way. Both are cheap. Sending whole chapters is
not — not because they would not fit, but because a writer's turn is re-billed
every time and prefix caching is byte-exact, so a novel-sized prefix is rewritten
every time an earlier paragraph changes. Under `PROSE_BUDGET_TOKENS` that stops
mattering and the chapters themselves are sent instead.
"""

import asyncio
import hashlib
import uuid
from collections.abc import Callable

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.digest import fold_digest, write_digest
from backend.agents.summarizer import summarize_node
from backend.db_models import Document
from backend.doc_storage import body_hash, get_bible_body, set_generated_summary
from backend.llm import Usage

#: Chapters whose own summary the agents read. Everything older is in the
#: digest, so this is a detail window, not the limit of what is remembered.
WINDOW = 5

#: While every earlier chapter together is this small, the agents read the
#: chapters themselves and nothing is summarized at all. About five full
#: chapters — the stretch where a book's voice is being set.
PROSE_BUDGET_TOKENS = 20_000

#: Measured against the demo project with `messages.count_tokens`: prose runs
#: about this many tokens per word. Used to pick a mode, never to bill.
TOKENS_PER_WORD = 1.33

#: How much of the previous chapter's ending rides verbatim, for voice.
VOICE_SAMPLE_WORDS = 400

#: Summarizing more chapters than this at once is a bill the writer should see
#: coming, so it is refused until they ask for it.
BACKFILL_CONFIRM_ABOVE = 5

#: Summarizer calls in flight at once. Unbounded, importing a finished novel
#: fired one per chapter simultaneously and earned a 429.
SUMMARIZE_CONCURRENCY = 4


def estimate_tokens(text: str) -> int:
    """Rough token count, for choosing a context mode. Local by design: asking
    the API what a request would cost is itself a request."""
    return int(len(text.split()) * TOKENS_PER_WORD)


def closing_prose(body: str, max_words: int = VOICE_SAMPLE_WORDS) -> str:
    """The end of a chapter, verbatim, cut at a paragraph boundary.

    This is the voice sample: how the writer's prose actually sounds and how
    the last chapter left off. A summary cannot carry it — the summarizer is
    told to discard exactly this. It costs nothing, being a slice of text the
    request already holds.
    """
    paragraphs = [p for p in body.split("\n\n") if p.strip()]
    if not paragraphs:
        return ""
    taken: list[str] = []
    words = 0
    for paragraph in reversed(paragraphs):
        count = len(paragraph.split())
        # The final paragraph goes in whole even when it is over budget: a
        # sample cut mid-sentence teaches the model to write that way.
        if taken and words + count > max_words:
            break
        taken.insert(0, paragraph)
        words += count
    return "\n\n".join(taken)


async def prior_chapters(
    db: AsyncSession, project_id: uuid.UUID, position: int
) -> list[Document]:
    """Every written chapter before `position`, in order.

    Notes are not chapters and an empty chapter has nothing to say, so neither
    is here. Nothing is capped: what falls out of the window is folded into the
    digest rather than forgotten.
    """
    result = await db.execute(
        select(Document)
        .where(
            Document.project_id == project_id,
            Document.kind == "chapter",
            Document.position < position,
            Document.body != "",
        )
        .order_by(Document.position)
    )
    return list(result.scalars())


def digest_hash(documents: list[Document]) -> str:
    """Identity of the chapters a digest was folded from.

    Over summary hashes rather than bodies: a body edit that leaves the summary
    alone (an edited summary the writer stands by) must not force a rebuild.
    """
    parts = [f"{d.id}:{d.summary_hash or ''}" for d in documents]
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


async def ensure_summaries(
    db: AsyncSession,
    documents: list[Document],
    model_key: str,
    on_usage: Callable[[Usage], None],
    *,
    confirmed: bool = False,
) -> None:
    """Summarize whatever in `documents` has no current summary.

    Reuses a cached summary while its body is unchanged, and never regenerates
    one the writer edited — their correction outranks a fresh invention.

    A large backfill (an imported novel, a project that has never generated) is
    refused with a 409 rather than silently spending a third of the month's
    budget inside someone's first request. The writer starts it deliberately.

    If some summaries fail, the ones that came back are still stored and
    reported, since they were billed, before the first failure is raised.
    """
    stale = [
        d
        for d in documents
        if not d.summary_edited and (d.summary is None or d.summary_hash != body_hash(d.body))
    ]
    if not stale:
        return
    if len(stale) > BACKFILL_CONFIRM_ABOVE and not confirmed:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{len(stale)} earlier chapters have not been summarized yet. "
                f"Summarizing them is {len(stale)} model calls, so it is started "
                f"from Story so far rather than inside this request."
            ),
        )

    limit = asyncio.Semaphore(SUMMARIZE_CONCURRENCY)

    async def one(document: Document):
        async with limit:
            return await summarize_node(document.body, model_key)

    # Only the API calls run concurrently. AsyncSession is not concurrency-safe,
    # so every DB write happens after the gather returns.
    results = await asyncio.gather(*(one(d) for d in stale), return_exceptions=True)
    failure: BaseException | None = None
    for document, result in zip(stale, results):
        if isinstance(result, BaseException):
            failure = failure or result
            continue
        summary, usage = result
        set_generated_summary(document, summary)
        on_usage(usage)
    await db.commit()
    if failure is not None:
        raise failure


async def build_previous_window(
    db: AsyncSession,
    project_id: uuid.UUID,
    position: int,
    model_key: str,
    on_usage: Callable[[Usage], None],
    *,
    confirmed: bool = False,
) -> list[tuple[str, str]]:
    """(title, summary) for the chapters in the window before `position`.

    Titles, not positions: the prompts label these for the model, and a chapter
    counted from the start of a sliding window carries the wrong number.
    """
    window = (await prior_chapters(db, project_id, position))[-WINDOW:]
    await ensure_summaries(db, window, model_key, on_usage, confirmed=confirmed)
    return [(d.title, d.summary) for d in window]


async def ensure_digest(
    db: AsyncSession,
    document: Document,
    older: list[Document],
    model_key: str,
    on_usage: Callable[[Usage], None],
) -> str | None:
    """The story so far as it stands before `document`, folding if it has moved on.

    Held on the chapter that reads it because it is a prefix: the digest read
    while revising chapter 6 must not contain chapter 30. Writing forward, each
    chapter's digest is its predecessor's plus one more chapter — one call.
    A changed, reordered or deleted earlier chapter cannot be folded onto, so
    the digest is rebuilt from every summary at once, which is still one call.
    """
    if not older:
        return None
    expected = digest_hash(older)
    if document.digest and (document.digest_edited or document.digest_hash == expected):
        return document.digest

    covered = _covered_prefix(document, older)
    if covered is not None and covered < len(older):
        text = document.digest
        for source in older[covered:]:
            text, usage = await fold_digest(text, source.title, source.summary, model_key)
            on_usage(usage)
    else:
        text, usage = await write_digest([(d.title, d.summary) for d in older], model_key)
        on_usage(usage)

    document.digest = text
    document.digest_hash = expected
    document.digest_edited = False
    await db.commit()
    return text


def _covered_prefix(document: Document, older: list[Document]) -> int | None:
    """How many of `older` the stored digest already covers, or None if it
    covers something else entirely and has to be rebuilt."""
    if not document.digest or not document.digest_hash:
        return None
    for count in range(len(older), 0, -1):
        if digest_hash(older[:count]) == document.digest_hash:
            return count
    return None


async def build_chapter_state(
    db: AsyncSession,
    document: Document,
    model_key: str,
    on_usage: Callable[[Usage], None],
    *,
    for_agent: str = "chat",
    confirmed: bool = False,
) -> dict:
    """Assemble agent state for a chapter from the project's documents.

    `for_agent` is "chat", "plan" or "review". It changes only the voice
    sample, which is for drafting prose; every agent reads the same facts.

    Building this can itself call the model — a prior chapter whose summary has
    gone stale is re-summarized here, and the digest folded — so it reports
    through `on_usage`. In prose mode it calls nothing at all.
    """
    prior = await prior_chapters(db, document.project_id, document.position)
    state = {
        "brief": document.brief,
        "story_bible": await get_bible_body(db, document.project_id),
        "digest": None,
        "previous_summaries": [],
        "previous_prose": [],
        "voice_sample": None,
        "scene_plan": document.plan or {},
        "draft": "",
    }

    if prose_mode(prior):
        # Short project: the chapters themselves, and nothing is summarized.
        state["previous_prose"] = [(d.title, d.body) for d in prior]
        return state

    window = prior[-WINDOW:]
    older = prior[: -len(window)] if window else prior
    await ensure_summaries(db, prior, model_key, on_usage, confirmed=confirmed)
    state["digest"] = await ensure_digest(db, document, older, model_key, on_usage)
    state["previous_summaries"] = [(d.title, d.summary) for d in window]
    if for_agent == "chat" and window:
        previous = window[-1]
        state["voice_sample"] = (previous.title, closing_prose(previous.body))
    return state


def prose_mode(prior: list[Document]) -> bool:
    """Whether the chapters themselves fit in the budget that summaries exist
    to protect. Below it, compressing them buys nothing and costs a call each."""
    return sum(estimate_tokens(d.body) for d in prior) <= PROSE_BUDGET_TOKENS
