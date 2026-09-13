from collections.abc import AsyncIterator, Callable

import anthropic

from backend.llm import Usage, request_params, usage_from

client = anthropic.AsyncAnthropic()

# A revision returns the whole chapter, so its ceiling has to fit a long one:
# roughly 6,500 tokens for 5,000 words, with room to spare.
_MAX_TOKENS = 16000


class RevisionTruncatedError(RuntimeError):
    """The model hit max_tokens before finishing the chapter; the partial reply
    would replace the writer's text with a chapter missing its ending."""


def _build_messages(state: dict) -> tuple[str, str]:
    """Build (system_prompt, user_content) for revising a draft against the
    continuity issues Check reported."""
    bible = state["story_bible"]
    plan = state["scene_plan"]
    issues_text = "\n".join(
        f"- [{i['severity'].upper()}] {i['issue']} (at {i['location']}): {i['suggested_fix']}"
        for i in state["continuity_issues"]
    )
    system_prompt = (
        "You are revising a chapter of literary fiction.\n"
        "Follow the voice and prose rules given in the story bible below.\n\n"
        f"STORY BIBLE:\n{bible}\n\n"
        "Fix all continuity issues listed below while preserving the overall narrative, characters, and style.\n"
        "Write only the revised prose. No commentary, no meta-text, no titles."
    )
    user_content = (
        f"Revise this draft to fix the following continuity issues.\n\n"
        f"CONTINUITY ISSUES TO FIX:\n{issues_text}\n\n"
        f"SCENE PLAN (for reference):\n"
        f"Goal: {plan.get('goal', '')}\n"
        f"POV: {plan.get('pov_character', '')}\n"
        f"Location: {plan.get('location', '')}\n\n"
        f"CURRENT DRAFT:\n{state['draft']}"
    )
    return system_prompt, user_content


async def reviser_token_stream(
    state: dict, model_key: str, on_usage: Callable[[Usage], None]
) -> AsyncIterator[str]:
    """Yield revised prose deltas as the model writes them. Owns the API call
    only; SSE framing and persistence are the endpoint's responsibility.

    Usage arrives through `on_usage` once the stream ends — including when the
    revision is rejected as truncated, since the call was billed either way.
    """
    system_prompt, user_content = _build_messages(state)

    async with client.messages.stream(
        **request_params(model_key, max_tokens=_MAX_TOKENS),
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    ) as stream:
        async for text in stream.text_stream:
            yield text

        final = await stream.get_final_message()
        on_usage(usage_from(final))
        if final.stop_reason == "max_tokens":
            raise RevisionTruncatedError(
                "The revision was cut off before the chapter ended, so the draft was left unchanged."
            )
