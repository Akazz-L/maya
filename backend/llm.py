"""Model catalogue, per-model request parameters, and token accounting.

One module owns everything that differs between the three models a writer can
pick. Callers name a *key* ("haiku"), never a model ID: a model bump is then a
one-line edit here rather than a data migration over every row that recorded
which model it used.
"""

from dataclasses import dataclass
from decimal import Decimal

# Cache reads bill at a tenth of the input rate; cache writes at 1.25x. Nothing
# in the app uses prompt caching yet, but recording the two counts costs nothing
# and keeps the recorded cost correct the day it does.
_CACHE_READ_RATE = Decimal("0.1")
_CACHE_WRITE_RATE = Decimal("1.25")

# Adaptive thinking spends tokens out of max_tokens before the first word of
# prose. Left at the drafter's 4096 ceiling, a chapter could be cut off mid
# sentence, so thinking models get this much headroom on prose calls.
_THINKING_HEADROOM = 8000


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    #: Shown beside the label in the picker, so the cost of the choice is legible.
    hint: str
    input_usd_per_mtok: Decimal
    output_usd_per_mtok: Decimal
    #: True for the Claude 5 generation, which runs adaptive thinking and
    #: supports `output_config.effort`.
    thinks: bool


MODELS: dict[str, ModelSpec] = {
    "haiku": ModelSpec(
        id="claude-haiku-4-5",
        label="Haiku 4.5",
        hint="fastest, cheapest",
        input_usd_per_mtok=Decimal("1.00"),
        output_usd_per_mtok=Decimal("5.00"),
        thinks=False,
    ),
    "sonnet": ModelSpec(
        id="claude-sonnet-5",
        label="Sonnet 5",
        hint="2x the cost of Haiku",
        input_usd_per_mtok=Decimal("2.00"),
        output_usd_per_mtok=Decimal("10.00"),
        thinks=True,
    ),
    "opus": ModelSpec(
        id="claude-opus-5",
        label="Opus 5",
        hint="best prose, 5x the cost of Haiku",
        input_usd_per_mtok=Decimal("5.00"),
        output_usd_per_mtok=Decimal("25.00"),
        thinks=True,
    ),
}

DEFAULT_MODEL_KEY = "haiku"


def spec_for(model_key: str) -> ModelSpec:
    try:
        return MODELS[model_key]
    except KeyError:
        raise ValueError(f"Unknown model key {model_key!r}") from None


@dataclass(frozen=True)
class Usage:
    """What one API call consumed. Mirrors the four fields of `message.usage`."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0


def usage_from(message) -> Usage:
    """Read usage off a Message or a stream's final message.

    The cache fields are absent or None on responses that used no caching, so
    every one is coerced rather than read directly.
    """
    raw = message.usage
    return Usage(
        input_tokens=getattr(raw, "input_tokens", 0) or 0,
        output_tokens=getattr(raw, "output_tokens", 0) or 0,
        cache_read_input_tokens=getattr(raw, "cache_read_input_tokens", 0) or 0,
        cache_creation_input_tokens=getattr(raw, "cache_creation_input_tokens", 0) or 0,
    )


def cost_usd(model_key: str, usage: Usage) -> Decimal:
    """Price one call, in dollars, rounded to the microdollar.

    Callers store the result rather than recomputing it later: a price change
    should not retroactively rewrite what a writer has already spent.
    """
    spec = spec_for(model_key)
    tokens = (
        usage.input_tokens
        + usage.cache_read_input_tokens * _CACHE_READ_RATE
        + usage.cache_creation_input_tokens * _CACHE_WRITE_RATE
    ) * spec.input_usd_per_mtok + usage.output_tokens * spec.output_usd_per_mtok
    return (tokens / Decimal(1_000_000)).quantize(Decimal("0.000001"))


def request_params(model_key: str, *, structured: bool, max_tokens: int) -> dict:
    """The per-model half of a messages.create/stream call.

    `structured` marks the calls that force a tool call and want no
    deliberation — the planner, checker, and summarizer — as opposed to the
    prose calls, where a little thinking is worth paying for.
    """
    spec = spec_for(model_key)
    params: dict = {"model": spec.id, "max_tokens": max_tokens}

    if not spec.thinks:
        # Haiku 4.5 does not think and has no effort control, so the defaults
        # are the whole request.
        return params

    # Sonnet 5 and Opus 5 think adaptively by default. Effort keeps that
    # thinking shallow: neither a scene plan nor a paragraph of fiction is a
    # reasoning problem, and effort is what we pay for.
    params["output_config"] = {"effort": "low"}
    if structured:
        # A forced tool call needs no deliberation, and thinking tokens would eat
        # the tight ceiling these calls run on.
        params["thinking"] = {"type": "disabled"}
    else:
        params["max_tokens"] = max_tokens + _THINKING_HEADROOM
    return params
