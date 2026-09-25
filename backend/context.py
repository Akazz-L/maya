import asyncio
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.summarizer import summarize_node
from backend.db_models import Document
from backend.doc_storage import body_hash, get_bible_body, set_generated_summary
from backend.llm import Usage

# Without a cap, the first generation on chapter 30 fires 29 model calls.
MAX_PRIOR_CHAPTERS = 10


async def build_chapter_state(
    db: AsyncSession,
    document: Document,
    model_key: str,
    on_usage: Callable[[Usage], None],
) -> dict:
    """Assemble agent state for a chapter from the project's documents. The
    writer's notes come from the document's own brief, so a chapter can sit
    anywhere; they are optional and may be empty.

    Building this can itself call the model — any prior chapter whose summary
    has gone stale is re-summarized here — so it reports through `on_usage`.
    """
    return {
        "brief": document.brief,
        "story_bible": await get_bible_body(db, document.project_id),
        "previous_summaries": await build_previous_summaries(
            db, document.project_id, document.position, model_key, on_usage
        ),
        "scene_plan": document.plan or {},
        "draft": "",
    }


async def prior_chapter_documents(
    db: AsyncSession, project_id: uuid.UUID, position: int
) -> list[Document]:
    """The written chapters an AI call on `position` reads, in order.

    Empty chapters have nothing to summarize and notes are not chapters, so
    neither is in the window; past `MAX_PRIOR_CHAPTERS` only the nearest are.
    Summarizes nothing, so the UI can name this list for free.
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
    return list(result.scalars())[-MAX_PRIOR_CHAPTERS:]


async def build_previous_summaries(
    db: AsyncSession,
    project_id: uuid.UUID,
    position: int,
    model_key: str,
    on_usage: Callable[[Usage], None],
) -> list[tuple[str, str]]:
    """(title, summary) for each chapter document preceding `position`, in order.

    Titles, not positions: the prompts label these for the model, and a chapter
    counted from the start of a sliding window carries the wrong number.

    Reuses a document's cached summary while its body is unchanged; summarizes
    the stale ones concurrently and writes the new summaries back. Each fresh
    summary costs an API call, so every one is reported through `on_usage`.

    A summary the writer edited is used as it stands, however far the body has
    drifted from it. Regenerating it is theirs to ask for.

    If some summaries fail, the ones that came back are still stored and
    reported, since they were billed, before the first failure is raised.
    """
    documents = await prior_chapter_documents(db, project_id, position)

    stale = [
        d
        for d in documents
        if not d.summary_edited and (d.summary is None or d.summary_hash != body_hash(d.body))
    ]
    if stale:
        # Only the API calls run concurrently. AsyncSession is not
        # concurrency-safe, so every DB write happens after the gather returns.
        results = await asyncio.gather(
            *(summarize_node(d.body, model_key) for d in stale), return_exceptions=True
        )
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

    return [(d.title, d.summary) for d in documents]
