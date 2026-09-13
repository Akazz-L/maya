"""The chapter chat: one model call per writer message.

The assistant replies in text and may attach one proposal, made through one of
two tools. A proposal is only ever shown to the writer for review; this module
computes what the chapter would become but never writes it anywhere.
"""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import anthropic

from backend.llm import Usage, request_params, usage_from

client = anthropic.AsyncAnthropic()

#: How much of the conversation the model sees. The pane keeps everything; the
#: model gets the recent past, which bounds the input cost of a long chat.
MAX_HISTORY_MESSAGES = 40

# A replace proposal carries the whole chapter: roughly 6,500 tokens for 5,000
# words, plus the reply text around it.
_MAX_TOKENS = 16000

_CACHED = {"type": "ephemeral"}

TOOLS = [
    {
        "name": "write_draft",
        "description": (
            "Propose new prose for the chapter. Use mode \"replace\" for a first draft, a draft "
            "from the scene plan, or a rewrite of the whole chapter; `text` is then the complete "
            "chapter. Use mode \"append\" to continue the chapter; `text` is then only the new "
            "prose that follows the existing text. The writer reviews the proposal before it "
            "changes anything."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["replace", "append"]},
                "text": {"type": "string", "description": "Prose only: no commentary, no titles."},
            },
            "required": ["mode", "text"],
        },
        # Streams the prose into the editor as it is written, rather than in
        # one lump once the whole tool call has been generated.
        "eager_input_streaming": True,
    },
    {
        "name": "edit_draft",
        "description": (
            "Propose targeted changes to the existing chapter text. Each edit replaces one "
            "passage: `find` must be copied exactly from the current chapter text and occur "
            "exactly once in it, and edits must not overlap. Everything outside the edited "
            "passages stays exactly as it is. The writer reviews the proposal before it "
            "changes anything."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "edits": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "find": {"type": "string"},
                            "replace": {"type": "string"},
                        },
                        "required": ["find", "replace"],
                    },
                }
            },
            "required": ["edits"],
        },
    },
]

_TOOL_CHOICE = {"type": "auto", "disable_parallel_tool_use": True}

_SYSTEM_RULES = (
    "You are a writing partner working with an author on one chapter of their work of literary fiction.\n"
    "Follow the voice and prose rules given in the story bible below, and give each character "
    "the speech patterns their dialogue examples establish.\n\n"
    "Every message from the writer arrives with the chapter as it stands: its brief, its scene "
    "plan if it has one, a summary of the previous chapter, and the current chapter text, "
    "including any edits the writer made by hand.\n\n"
    "To change the chapter:\n"
    "- For a first draft, a draft from the scene plan, or a rewrite of the whole chapter, "
    "call write_draft with mode \"replace\".\n"
    "- To continue the chapter, call write_draft with mode \"append\" and only the new prose.\n"
    "- For targeted changes to existing prose, call edit_draft. Copy each `find` exactly from the "
    "current chapter text, long enough to match exactly once, and keep each edit as small as the "
    "change allows.\n"
    "- Propose at most one change per reply. It is shown to the writer for review and is not part "
    "of the chapter until they accept it; you will be told whether they did.\n"
    "- Tool input is prose only: no commentary, no meta-text, no titles.\n"
    "- When the writer asks a question or wants feedback, answer in text without calling a tool.\n\n"
    "Keep text replies short: a sentence or two on what you changed and why, or a direct answer."
)

_OUTCOME_NOTES = {
    "accepted": "The writer accepted your last proposal; it is now part of the chapter.",
    "discarded": "The writer discarded your last proposal; the chapter did not change.",
    "stale": (
        "Your last proposal could not be applied because the chapter changed before the writer "
        "reviewed it; the chapter did not change."
    ),
}


class ProposalError(ValueError):
    """A tool call that cannot become a proposal: a malformed write, or edits
    that do not match the chapter. The message is written for the model."""


class ChatTruncatedError(RuntimeError):
    """The reply hit max_tokens; a half-written proposal is not reviewable."""


class EmptyReplyError(RuntimeError):
    """The model answered with neither text nor a proposal."""


@dataclass(frozen=True)
class TextDelta:
    text: str


@dataclass(frozen=True)
class ProposalProgress:
    """The prose of a write_draft call so far. `mode` is None until it arrives."""

    mode: str | None
    text: str


@dataclass(frozen=True)
class ProposalReady:
    proposal: dict


ChatEvent = TextDelta | ProposalProgress | ProposalReady


# ---------------------------------------------------------------------------
# Proposals
# ---------------------------------------------------------------------------


def _occurrences(body: str, find: str) -> list[int]:
    """Every start index of `find` in `body`, overlapping matches included."""
    starts, i = [], body.find(find)
    while i != -1:
        starts.append(i)
        i = body.find(find, i + 1)
    return starts


def apply_edits(body: str, edits: list[dict]) -> str:
    """Apply find/replace edits against the original body.

    Each `find` must be non-empty and occur exactly once, and no two may
    overlap; otherwise nothing is applied and every problem is reported at once,
    so a single correction can fix them all.
    """
    problems: list[str] = []
    spans: list[tuple[int, int, str, int]] = []
    for number, edit in enumerate(edits, start=1):
        find = edit.get("find") or ""
        if not find:
            problems.append(f"Edit {number}: `find` is empty.")
            continue
        starts = _occurrences(body, find)
        if not starts:
            problems.append(
                f"Edit {number}: `find` does not appear in the chapter. "
                "Copy it exactly from the current chapter text."
            )
        elif len(starts) > 1:
            problems.append(
                f"Edit {number}: `find` appears {len(starts)} times. "
                "Include more of the surrounding text so it matches exactly once."
            )
        else:
            spans.append((starts[0], starts[0] + len(find), edit.get("replace") or "", number))

    spans.sort()
    for (_, end, _, first), (start, _, _, second) in zip(spans, spans[1:]):
        if start < end:
            numbers = sorted((first, second))
            problems.append(f"Edits {numbers[0]} and {numbers[1]} overlap; merge them into one edit.")
    if problems:
        raise ProposalError("\n".join(problems))

    out, cursor = [], 0
    for start, end, replacement, _ in spans:
        out.append(body[cursor:start])
        out.append(replacement)
        cursor = end
    out.append(body[cursor:])
    return "".join(out)


def build_proposal(body: str, tool_name: str, tool_input: dict) -> dict:
    """Turn a tool call into a proposal, including the whole body it would produce."""
    if tool_name == "write_draft":
        mode = tool_input.get("mode")
        text = tool_input.get("text") or ""
        if mode not in ("replace", "append"):
            raise ProposalError(f"`mode` must be \"replace\" or \"append\", not {mode!r}.")
        if not text.strip():
            raise ProposalError("`text` is empty.")
        if mode == "replace" or not body.strip():
            proposed = text
        else:
            proposed = f"{body.rstrip()}\n\n{text.lstrip()}"
        return {"kind": "write", "mode": mode, "text": text, "proposed_body": proposed}

    if tool_name == "edit_draft":
        edits = [
            {"find": e.get("find") or "", "replace": e.get("replace") or ""}
            for e in tool_input.get("edits") or []
        ]
        if not edits:
            raise ProposalError("`edits` is empty.")
        return {"kind": "edit", "edits": edits, "proposed_body": apply_edits(body, edits)}

    raise ProposalError(f"Unknown tool {tool_name!r}.")


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


def describe_proposal(proposal: dict) -> str:
    """How an earlier proposal appears in the history the model sees. The prose
    itself is never replayed: an accepted one is already in the chapter text."""
    if proposal["kind"] == "write":
        words = len(proposal["text"].split())
        if proposal["mode"] == "replace":
            return f"[You proposed replacing the chapter with a new draft of {words} words.]"
        return f"[You proposed appending {words} words to the end of the chapter.]"
    lines = [f"[You proposed {len(proposal['edits'])} edit(s) to the chapter:"]
    lines += [f"- replace «{e['find']}» with «{e['replace']}»" for e in proposal["edits"]]
    return "\n".join(lines) + "]"


def _outcome_note(message: dict) -> str | None:
    proposal = message.get("proposal")
    if message["role"] != "assistant" or not proposal or not proposal.get("outcome"):
        return None
    return f"({_OUTCOME_NOTES[proposal['outcome']]})"


def render_history(messages: list[dict]) -> list[dict]:
    """Earlier turns as plain-text API messages.

    Text rather than replayed tool_use/tool_result blocks, so a request never
    depends on which model wrote an earlier turn (the writer can switch models
    mid-conversation) or on thinking-block replay rules. A proposal's outcome is
    stated at the start of the user message after it, so a message renders the
    same way every time once written, which keeps the prompt prefix cacheable.
    """
    start = max(0, len(messages) - MAX_HISTORY_MESSAGES)
    while start < len(messages) and messages[start]["role"] != "user":
        start += 1

    rendered = []
    for index in range(start, len(messages)):
        message = messages[index]
        if message["role"] == "user":
            note = _outcome_note(messages[index - 1]) if index > 0 else None
            content = f"{note}\n\n{message['content']}" if note else message["content"]
        else:
            parts = [message["content"]] if message["content"].strip() else []
            if message.get("proposal"):
                parts.append(describe_proposal(message["proposal"]))
            content = "\n\n".join(parts) or "(no reply)"
        rendered.append({"role": message["role"], "content": content})
    return rendered


def _plan_text(plan: dict) -> str:
    if not plan:
        return "No scene plan."
    beats = "\n".join(f"- {b}" for b in plan.get("beats", []))
    return (
        f"Goal: {plan.get('goal', '')}\n"
        f"POV: {plan.get('pov_character', '')}\n"
        f"Location: {plan.get('location', '')}\n"
        f"Beats:\n{beats}\n"
        f"Opening image: {plan.get('opening_image', '')}\n"
        f"Closing image: {plan.get('closing_image', '')}\n"
        f"Sensory anchor: {plan.get('sensory_anchor', '')}"
    )


def build_turn(state: dict) -> tuple[list[dict], list[dict]]:
    """Build (system, messages) for one writer message.

    Stable content comes first so the prefix caches across turns: the rules and
    the bible, then the history. The chapter as it stands changes every turn,
    so it rides in the new message at the end.
    """
    system = [
        {
            "type": "text",
            "text": f"{_SYSTEM_RULES}\n\nSTORY BIBLE:\n{state['story_bible']}",
            "cache_control": _CACHED,
        }
    ]

    history = render_history(state["history"])
    if history:
        last = history[-1]
        last["content"] = [{"type": "text", "text": last["content"], "cache_control": _CACHED}]

    summaries = state["previous_summaries"]
    parts = [
        f"CHAPTER BRIEF:\n{state['outline_beat'] or '(none)'}",
        f"SCENE PLAN:\n{_plan_text(state['scene_plan'])}",
        f"PREVIOUS CHAPTER:\n{summaries[-1] if summaries else 'This is the first chapter.'}",
        f"CURRENT CHAPTER TEXT:\n{state['draft'] or '(The chapter is empty.)'}",
    ]
    note = _outcome_note(state["history"][-1]) if state["history"] else None
    if note:
        parts.append(note)
    parts.append(f"WRITER'S MESSAGE:\n{state['message']}")

    return system, history + [{"role": "user", "content": "\n\n".join(parts)}]


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


async def chat_event_stream(
    state: dict, model_key: str, on_usage: Callable[[Usage], None]
) -> AsyncIterator[ChatEvent]:
    """Yield the reply as it is written, then the proposal if there is one.

    Owns the API calls only; SSE framing and persistence are the endpoint's job.
    Usage is reported through `on_usage` after every call, including one whose
    reply is then rejected, since each was billed.

    A tool call that cannot become a proposal gets one correction within the
    turn: the model sees why and tries again. A second failure raises.
    """
    system, messages = build_turn(state)
    body = state["draft"]
    wrote_text = False

    for attempt in range(2):
        async with client.messages.stream(
            **request_params(model_key, max_tokens=_MAX_TOKENS),
            system=system,
            tools=TOOLS,
            tool_choice=_TOOL_CHOICE,
            messages=messages,
        ) as stream:
            tool_name: str | None = None
            last_progress: ProposalProgress | None = None
            async for event in stream:
                if event.type == "text":
                    wrote_text = wrote_text or bool(event.text.strip())
                    yield TextDelta(event.text)
                elif event.type == "content_block_start":
                    block = event.content_block
                    tool_name = block.name if block.type == "tool_use" else None
                elif event.type == "input_json" and tool_name == "write_draft":
                    snapshot = event.snapshot if isinstance(event.snapshot, dict) else {}
                    progress = ProposalProgress(snapshot.get("mode"), snapshot.get("text") or "")
                    if progress.text and progress != last_progress:
                        last_progress = progress
                        yield progress

            final = await stream.get_final_message()
            on_usage(usage_from(final))

        if final.stop_reason == "max_tokens":
            raise ChatTruncatedError(
                "The reply was cut off before it finished. Ask for a smaller change."
            )

        tool_use = next((b for b in final.content if b.type == "tool_use"), None)
        if tool_use is None:
            if not wrote_text:
                raise EmptyReplyError("The model returned an empty reply.")
            return

        try:
            proposal = build_proposal(body, tool_use.name, tool_use.input)
        except ProposalError as error:
            if attempt:
                raise
            messages = messages + [
                {"role": "assistant", "content": final.content},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "is_error": True,
                            "content": f"{error}\nNothing was proposed. Call the tool again with corrected input.",
                        }
                    ],
                },
            ]
            continue

        yield ProposalReady(proposal)
        return
