import anthropic

from backend.settings import get_model

client = anthropic.AsyncAnthropic()


async def summarize_node(text: str) -> str:
    """Condense a chapter body into the continuity-relevant facts the planner,
    drafter, and checker need from prior chapters."""
    response = await client.messages.create(
        model=get_model(),
        max_tokens=512,
        system=(
            "You summarize chapters of a novel for a continuity system. Record plot "
            "events, what each character now knows, and any physical, spatial, or "
            "temporal facts established. Omit prose style and atmosphere. "
            "Write a compact paragraph. No preamble."
        ),
        messages=[{"role": "user", "content": f"Summarize this chapter:\n\n{text}"}],
    )
    if not response.content:
        raise ValueError(
            f"Summarizer received empty content from API (stop_reason={response.stop_reason!r})"
        )
    return response.content[0].text
