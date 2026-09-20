"""The chapter chat: one model call per writer message.

The assistant replies in text and may attach one proposal, made through one of
two tools. A proposal is only ever shown to the writer for review; this module
computes what the chapter would become but never writes it anywhere.

A `suggest_fixes` proposal is a *set* of localized fixes, each with its own
explanation and its own outcome: the writer takes the ones they want. The
streaming loop that turns a tool call into a reviewable proposal is shared with
the specialist reviewers in `backend.agents.reviewers`.
"""

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import anthropic
from jiter import from_json

from backend.llm import Usage, request_params, usage_from

client = anthropic.AsyncAnthropic()

#: How much of the conversation the model sees. The pane keeps everything; the
#: model gets the recent past, which bounds the input cost of a long chat.
MAX_HISTORY_MESSAGES = 40

# A replace proposal carries the whole chapter: roughly 6,500 tokens for 5,000
# words, plus the reply text around it.
_MAX_TOKENS = 16000

_CACHED = {"type": "ephemeral"}

SEVERITIES = ["critical", "minor", "style"]

def suggest_tool(*, rate_severity: bool = False) -> dict:
    """The one tool that proposes localized fixes, shared by the chat and by
    every specialist reviewer, so a proposal has one shape however it was asked
    for.

    A review pass must rate what it finds — the severity drives the dot and the
    colour on each card — and a model that is merely told to set an optional
    field often will not, so the reviewers' copy requires it. Asking an ordinary
    chat edit how serious it is would be noise, so theirs does not.
    """
    return {
        "name": "suggest_fixes",
        "description": (
            "Propose targeted changes to the existing chapter text, as a set of separate fixes the "
            "writer accepts or discards one at a time. Each fix replaces one passage: `find` must "
            "be copied exactly from the current chapter text and occur exactly once in it, and "
            "fixes must not overlap. `replace` must differ from `find`: this tool changes prose, "
            "and a remark about a passage you are not changing belongs in your text reply. "
            "Everything outside the edited passages stays exactly as it is. Keep each fix as small "
            "as the change allows, and give each one an `explanation`: one sentence on what is "
            "wrong, which is shown beside the fix in the margin."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "fixes": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "find": {"type": "string"},
                            "replace": {"type": "string"},
                            "explanation": {
                                "type": "string",
                                "description": "One sentence on what is wrong with the passage.",
                            },
                            "severity": {
                                "type": "string",
                                "enum": SEVERITIES,
                                "description": "How serious the problem is.",
                            },
                        },
                        "required": ["find", "replace", "explanation"]
                        + (["severity"] if rate_severity else []),
                    },
                }
            },
            "required": ["fixes"],
        },
    }


SUGGEST_TOOL = suggest_tool()

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
    SUGGEST_TOOL,
]

_TOOL_CHOICE = {"type": "auto", "disable_parallel_tool_use": True}

_SYSTEM_RULES = (
    "You are a writing partner working with an author on one chapter of their work of literary fiction.\n"
    "Follow the voice and prose rules given in the story bible below, and give each character "
    "the speech patterns their dialogue examples establish.\n\n"
    "Every message from the writer arrives with the chapter as it stands: the author's notes "
    "for it if they wrote any, its scene plan if it has one, a summary of the previous chapter, and the current chapter text, "
    "including any edits the writer made by hand.\n\n"
    "To change the chapter:\n"
    "- For a first draft, a draft from the scene plan, or a rewrite of the whole chapter, "
    "call write_draft with mode \"replace\".\n"
    "- To continue the chapter, call write_draft with mode \"append\" and only the new prose.\n"
    "- For targeted changes to existing prose, call suggest_fixes. Copy each `find` exactly from "
    "the current chapter text, long enough to match exactly once, and keep each fix as small as "
    "the change allows.\n"
    "- Call at most one tool per reply. Its fixes are shown to the writer in the margin of the "
    "chapter and are not part of it until they accept them, one by one; you will be told which "
    "ones they took.\n"
    "- `find` and `replace` are prose only: no commentary, no meta-text, no titles. The commentary "
    "goes in `explanation`.\n"
    "- When the writer asks a question or wants feedback, answer in text without calling a tool.\n\n"
    "Keep text replies short: a sentence or two on what you changed and why, or a direct answer."
)

_WRITE_NOTES = {
    "accepted": "The writer accepted your last proposal; it is now part of the chapter.",
    "discarded": "The writer discarded your last proposal; the chapter did not change.",
    "stale": (
        "Your last proposal could not be applied because the chapter changed before the writer "
        "reviewed it; the chapter did not change."
    ),
}


class ProposalError(ValueError):
    """A tool call that cannot become a proposal: a malformed write, or fixes
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


def resolve_spans(body: str, fixes: list[dict]) -> list[tuple[int, int, int]]:
    """Locate each fix in `body`, as `(from, to, original index)` in document order.

    Each `find` must be non-empty and occur exactly once, and no two may
    overlap; otherwise nothing is located and every problem is reported at once,
    so a single correction can fix them all.
    """
    problems: list[str] = []
    spans: list[tuple[int, int, int]] = []
    for index, fix in enumerate(fixes):
        number = index + 1
        find = fix.get("find") or ""
        if not find:
            problems.append(f"Fix {number}: `find` is empty.")
            continue
        starts = _occurrences(body, find)
        if not starts:
            problems.append(
                f"Fix {number}: `find` does not appear in the chapter. "
                "Copy it exactly from the current chapter text."
            )
        elif len(starts) > 1:
            problems.append(
                f"Fix {number}: `find` appears {len(starts)} times. "
                "Include more of the surrounding text so it matches exactly once."
            )
        else:
            spans.append((starts[0], starts[0] + len(find), index))

    spans.sort()
    for (_, end, first), (start, _, second) in zip(spans, spans[1:]):
        if start < end:
            numbers = sorted((first + 1, second + 1))
            problems.append(f"Fixes {numbers[0]} and {numbers[1]} overlap; merge them into one fix.")
    if problems:
        raise ProposalError("\n".join(problems))
    return spans


def apply_fixes(body: str, fixes: list[dict]) -> str:
    """The body with every fix applied. Used to describe a set, not to store one:
    a suggestion set is applied fix by fix, in the editor, as the writer accepts."""
    out, cursor = [], 0
    for start, end, index in resolve_spans(body, fixes):
        out.append(body[cursor:start])
        out.append(fixes[index].get("replace") or "")
        cursor = end
    out.append(body[cursor:])
    return "".join(out)


def build_suggestions(body: str, fixes: list[dict]) -> list[dict]:
    """Validated fixes as suggestions, in document order, each with its offsets
    into `body` and its own unresolved outcome."""
    suggestions = []
    for start, end, index in resolve_spans(body, fixes):
        fix = fixes[index]
        severity = fix.get("severity")
        suggestions.append(
            {
                "find": fix.get("find") or "",
                "replace": fix.get("replace") or "",
                "explanation": (fix.get("explanation") or "").strip(),
                "severity": severity if severity in SEVERITIES else None,
                "from": start,
                "to": end,
                "outcome": None,
            }
        )
    return suggestions


def build_proposal(body: str, tool_name: str, tool_input: dict) -> dict:
    """Turn a tool call into a proposal the writer can review."""
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

    if tool_name == "suggest_fixes":
        fixes = tool_input.get("fixes") or []
        if not fixes:
            raise ProposalError("`fixes` is empty.")
        problems = []
        for number, fix in enumerate(fixes, start=1):
            if not (fix.get("explanation") or "").strip():
                problems.append(
                    f"Fix {number}: `explanation` is empty. "
                    "Every fix needs one sentence on what is wrong."
                )
            # A fix that changes nothing draws an empty diff in the margin and
            # asks the writer to accept a no-op.
            if (fix.get("find") or "") == (fix.get("replace") or ""):
                problems.append(
                    f"Fix {number}: `replace` is identical to `find`, so it changes nothing. "
                    "Propose the corrected prose, or drop the fix and say it in your reply instead."
                )
        if problems:
            raise ProposalError("\n".join(problems))
        return {"kind": "suggestions", "suggestions": build_suggestions(body, fixes)}

    raise ProposalError(f"Unknown tool {tool_name!r}.")


def pending_indexes(proposal: dict) -> list[int]:
    """Which suggestions in a set are still unreviewed. Empty for `write`."""
    if proposal.get("kind") != "suggestions":
        return []
    return [i for i, s in enumerate(proposal["suggestions"]) if s.get("outcome") is None]


def is_pending(proposal: dict | None) -> bool:
    """Whether a proposal still awaits the writer: a `write` with no outcome, or
    a set with any fix left unreviewed."""
    if not proposal:
        return False
    if proposal.get("kind") == "suggestions":
        return bool(pending_indexes(proposal))
    return proposal.get("outcome") is None


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------


def describe_proposal(proposal: dict) -> str:
    """How an earlier proposal appears in the history the model sees.

    States only what was proposed, never what became of it: an assistant message
    must render the same way before and after the writer reviews it, or resolving
    a proposal would invalidate the cached prompt prefix. The outcome rides on
    the following user message instead.
    """
    if proposal["kind"] == "write":
        words = len(proposal["text"].split())
        if proposal["mode"] == "replace":
            return f"[You proposed replacing the chapter with a new draft of {words} words.]"
        return f"[You proposed appending {words} words to the end of the chapter.]"

    suggestions = proposal["suggestions"]
    lines = [f"[You proposed {_fixes(range(1, len(suggestions) + 1))} to the chapter:"]
    for number, s in enumerate(suggestions, start=1):
        lines.append(f"{number}. replace «{s['find']}» with «{s['replace']}» — {s['explanation']}")
    return "\n".join(lines) + "]"


def _fixes(numbers) -> str:
    """'fix 1', 'fixes 1 and 2', 'fixes 1, 2 and 4'."""
    numbers = list(numbers)
    if len(numbers) == 1:
        return f"fix {numbers[0]}"
    listed = f"{', '.join(str(n) for n in numbers[:-1])} and {numbers[-1]}"
    return f"fixes {listed}"


def _suggestions_note(suggestions: list[dict]) -> str:
    """What the writer did with a set of fixes, fix by fix."""
    groups: dict[str | None, list[int]] = {"accepted": [], "discarded": [], "stale": [], None: []}
    for number, s in enumerate(suggestions, start=1):
        groups.setdefault(s.get("outcome"), []).append(number)

    clauses = []
    if groups["accepted"]:
        clauses.append(f"accepted {_fixes(groups['accepted'])}")
    if groups["discarded"]:
        clauses.append(f"discarded {_fixes(groups['discarded'])}")
    if groups["stale"]:
        clauses.append(
            f"could not apply {_fixes(groups['stale'])}, "
            "because the chapter changed before it was reviewed"
        )
    if groups[None]:
        clauses.append(f"has not yet reviewed {_fixes(groups[None])}")

    tail = (
        "The accepted ones are now part of the chapter."
        if groups["accepted"]
        else "The chapter did not change."
    )
    return f"The writer {', and '.join(clauses)}. {tail}"


def _outcome_note(message: dict) -> str | None:
    proposal = message.get("proposal")
    if message["role"] != "assistant" or not proposal:
        return None
    if proposal.get("kind") == "suggestions":
        if all(s.get("outcome") is None for s in proposal["suggestions"]):
            return None
        return f"({_suggestions_note(proposal['suggestions'])})"
    if not proposal.get("outcome"):
        return None
    return f"({_WRITE_NOTES[proposal['outcome']]})"


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


def plan_text(plan: dict) -> str:
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
        f"CHAPTER NOTES:\n{state['brief'].strip() or '(The author has not written notes for this chapter.)'}",
        f"SCENE PLAN:\n{plan_text(state['scene_plan'])}",
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


def _progress_from(partial_json: str) -> ProposalProgress | None:
    """The prose written so far, read from the raw tool-call JSON.

    Not from the SDK's own snapshot: it parses with jiter's `partial_mode=True`,
    which drops a trailing incomplete string, so `text` appears only once the
    whole tool call has arrived — the writer would get the finished draft in one
    lump instead of watching it arrive. `trailing-strings` keeps the prose as it
    is written.
    """
    try:
        value = from_json(partial_json.encode(), partial_mode="trailing-strings")
    except ValueError:
        return None  # not yet parseable; the next fragment usually is
    if not isinstance(value, dict):
        return None
    text = value.get("text")
    if not isinstance(text, str) or not text:
        return None
    mode = value.get("mode")
    # The mode can itself be half-written ("rep"); only a whole one is meaningful.
    return ProposalProgress(mode if mode in ("replace", "append") else None, text)


async def stream_turn(
    *,
    system: list[dict],
    messages: list[dict],
    tools: list[dict],
    tool_choice: dict,
    body: str,
    model_key: str,
    on_usage: Callable[[Usage], None],
    require_text: bool = True,
) -> AsyncIterator[ChatEvent]:
    """Stream one assistant turn: the reply as it is written, then its proposal.

    Shared by the chat and by the specialist reviewers, which differ only in
    their prompt and in forcing a tool. Owns the API calls only; SSE framing and
    persistence are the endpoint's job. Usage is reported through `on_usage`
    after every call, including one whose reply is then rejected, since each was
    billed.

    A tool call that cannot become a proposal gets one correction within the
    turn: the model sees why and tries again. A second failure raises.
    """
    wrote_text = False

    for attempt in range(2):
        async with client.messages.stream(
            **request_params(model_key, max_tokens=_MAX_TOKENS),
            system=system,
            tools=tools,
            tool_choice=tool_choice,
            messages=messages,
        ) as stream:
            tool_name: str | None = None
            json_buf = ""
            last_progress: ProposalProgress | None = None
            async for event in stream:
                if event.type == "text":
                    wrote_text = wrote_text or bool(event.text.strip())
                    yield TextDelta(event.text)
                elif event.type == "content_block_start":
                    block = event.content_block
                    tool_name = block.name if block.type == "tool_use" else None
                    json_buf = ""
                elif event.type == "input_json" and tool_name == "write_draft":
                    json_buf += event.partial_json
                    progress = _progress_from(json_buf)
                    if progress and progress != last_progress:
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
            if require_text and not wrote_text:
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


async def chat_event_stream(
    state: dict, model_key: str, on_usage: Callable[[Usage], None]
) -> AsyncIterator[ChatEvent]:
    """Answer one writer message: the reply as it is written, then the proposal
    if there is one."""
    system, messages = build_turn(state)
    async for event in stream_turn(
        system=system,
        messages=messages,
        tools=TOOLS,
        tool_choice=_TOOL_CHOICE,
        body=state["draft"],
        model_key=model_key,
        on_usage=on_usage,
    ):
        yield event
