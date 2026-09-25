"""The story so far: the running digest of everything before the summary window.

Chapter summaries answer "what happened in chapter 7". This answers "what does
the reader know by now", which is what a drafter and a continuity checker
actually need once a book is longer than a handful of chapters.

Two entry points, because the cost profile differs. `fold_digest` adds one
chapter to an existing digest — the normal path, one call per chapter in its
life. `write_digest` builds one from every summary at once, for when an edit to
an early chapter invalidates what was folded; summaries are small, so rebuilding
forty chapters is one call rather than forty.
"""

import anthropic

from backend.llm import Usage, request_params, usage_from

client = anthropic.AsyncAnthropic()

#: Kept short on purpose: the digest rides in every request on the chapter, so
#: its size is a per-turn cost. Detail belongs in the recent summaries.
MAX_TOKENS = 1200

_SHAPE = (
    "Write the digest under exactly these headings, each a short paragraph or a "
    "few bullets:\n"
    "Where everyone is\n"
    "What each character knows\n"
    "Unresolved threads\n"
    "Timeline\n\n"
    "Record only what is established: plot events, what each character knows and "
    "when they learned it, physical and spatial facts, elapsed time. Omit prose "
    "style and atmosphere. Keep the whole digest under 500 words — when it runs "
    "long, drop the details a later chapter has already settled rather than the "
    "facts still in play. No preamble."
)

_SYSTEM = (
    "You maintain the continuity record for a novel in progress. It is read by "
    "the agents that plan, draft, and check later chapters, so it must be "
    "accurate and current rather than complete.\n\n" + _SHAPE
)


async def write_digest(
    summaries: list[tuple[str, str]], model_key: str
) -> tuple[str, Usage]:
    """Build a digest from every chapter summary it covers, in one call."""
    body = "\n\n".join(f"{title}:\n{summary}" for title, summary in summaries)
    return await _call(
        model_key,
        f"Here are the chapters of the novel so far, in order.\n\n{body}\n\n"
        "Write the continuity record as it stands at the end of these chapters.",
    )


async def fold_digest(
    digest: str, title: str, summary: str, model_key: str
) -> tuple[str, Usage]:
    """Fold one more chapter into an existing digest.

    The result replaces the digest, so the prompt asks for the whole record
    back rather than an addition to it: a fact the new chapter overturns has to
    be corrected in place, not appended to.
    """
    return await _call(
        model_key,
        f"This is the continuity record so far:\n\n{digest}\n\n"
        f"The next chapter, {title}, has now been read:\n\n{summary}\n\n"
        "Rewrite the record so it is current as of the end of that chapter. "
        "Carry forward everything still true, correct what it changed, and drop "
        "what it resolved.",
    )


async def _call(model_key: str, message: str) -> tuple[str, Usage]:
    response = await client.messages.create(
        **request_params(model_key, max_tokens=MAX_TOKENS),
        system=_SYSTEM,
        messages=[{"role": "user", "content": message}],
    )
    # Sonnet 5 and Opus 5 think adaptively, so a thinking block can come first.
    text = "".join(b.text for b in response.content if b.type == "text")
    if not text:
        raise ValueError(
            f"Digest received no text from API (stop_reason={response.stop_reason!r})"
        )
    return text, usage_from(response)
