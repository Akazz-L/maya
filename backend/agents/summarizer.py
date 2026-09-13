import anthropic

from backend.llm import Usage, request_params, usage_from

client = anthropic.AsyncAnthropic()


async def summarize_node(text: str, model_key: str) -> tuple[str, Usage]:
    """Condense a chapter body into the continuity-relevant facts the planner,
    chat, and checker need from prior chapters.

    Returns the summary and what it cost. These calls run implicitly, before
    every generation, so they are real spend and are metered like any other."""
    response = await client.messages.create(
        **request_params(model_key, max_tokens=512),
        system=(
            "You summarize chapters of a novel for a continuity system. Record plot "
            "events, what each character now knows, and any physical, spatial, or "
            "temporal facts established. Omit prose style and atmosphere. "
            "Write a compact paragraph. No preamble."
        ),
        messages=[{"role": "user", "content": f"Summarize this chapter:\n\n{text}"}],
    )
    # Sonnet 5 and Opus 5 think adaptively, so a thinking block can come first.
    text = "".join(b.text for b in response.content if b.type == "text")
    if not text:
        raise ValueError(
            f"Summarizer received no text from API (stop_reason={response.stop_reason!r})"
        )
    return text, usage_from(response)
