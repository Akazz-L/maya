from collections.abc import AsyncIterator

import anthropic
from backend.settings import get_model

client = anthropic.AsyncAnthropic()


class RewriteTruncatedError(RuntimeError):
    """The model hit max_tokens before finishing the passage; the partial reply is unusable."""


def _build_rewrite_messages(state: dict) -> tuple[str, str]:
    """Build (system_prompt, user_content) for a span rewrite.

    The model sees only the selected passage plus read-only context and must
    return only the replacement. The surrounding text is spliced back in
    client-side, so everything outside the selection is preserved by
    construction rather than by trusting the model.
    """
    bible = state["story_bible"]

    system_prompt = (
        "You are rewriting a passage of literary fiction.\n"
        "Follow the voice and prose rules given in the story bible below.\n\n"
        f"STORY BIBLE:\n{bible}\n\n"
        "Rewrite ONLY the passage marked PASSAGE TO REWRITE, following the instruction.\n"
        "The context before and after is shown for continuity only: do not rewrite or repeat it.\n"
        "Your reply must begin where the passage begins and end where the passage ends. "
        "Do not repeat any of the context before or continue into the context after.\n"
        "Write only the replacement prose. No commentary, no meta-text, no titles."
    )
    user_content = (
        f"INSTRUCTION:\n{state['instruction']}\n\n"
        f"CONTEXT BEFORE (do not rewrite):\n{state['before']}\n\n"
        f"PASSAGE TO REWRITE:\n{state['selection']}\n\n"
        f"CONTEXT AFTER (do not rewrite):\n{state['after']}"
    )
    return system_prompt, user_content


async def rewriter_token_stream(state: dict) -> AsyncIterator[str]:
    """Yield replacement text deltas as the model writes them. Owns the API
    call only; SSE framing is the endpoint's responsibility."""
    system_prompt, user_content = _build_rewrite_messages(state)

    async with client.messages.stream(
        model=get_model(),
        max_tokens=4096,
        temperature=0.9,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    ) as stream:
        async for text in stream.text_stream:
            yield text

        # A reply cut off at max_tokens ends mid-passage. Splicing that over the
        # writer's prose would quietly delete the tail of their selection, so
        # fail instead and let the client keep the original.
        final = await stream.get_final_message()
        if final.stop_reason == "max_tokens":
            raise RewriteTruncatedError(
                "The rewrite was cut off before the passage ended. Select a shorter passage."
            )
