import asyncio
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.agents.summarizer import summarize_node
from backend.db_models import Document
from backend.doc_storage import body_hash

# Without a cap, the first generation on chapter 30 fires 29 model calls.
MAX_PRIOR_CHAPTERS = 10


async def build_previous_summaries(
    db: AsyncSession, project_id: uuid.UUID, position: int
) -> list[str]:
    """Summaries of the chapter documents preceding `position`, in order.

    Reuses a document's cached summary while its body is unchanged; summarizes
    the stale ones concurrently and writes the new summaries back.
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
    documents = list(result.scalars())[-MAX_PRIOR_CHAPTERS:]

    stale = [d for d in documents if d.summary is None or d.summary_hash != body_hash(d.body)]
    if stale:
        # Only the API calls run concurrently. AsyncSession is not
        # concurrency-safe, so every DB write happens after the gather returns.
        summaries = await asyncio.gather(*(summarize_node(d.body) for d in stale))
        for document, summary in zip(stale, summaries):
            document.summary = summary
            document.summary_hash = body_hash(document.body)
        await db.commit()

    return [d.summary for d in documents]
