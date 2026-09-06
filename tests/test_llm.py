from decimal import Decimal
from types import SimpleNamespace

import pytest

from backend.llm import MODELS, Usage, cost_usd, request_params, spec_for, usage_from


def test_every_key_maps_to_a_distinct_model_id():
    ids = [spec.id for spec in MODELS.values()]
    assert set(MODELS) == {"haiku", "sonnet", "opus"}
    assert len(set(ids)) == len(ids)


def test_unknown_key_is_rejected():
    with pytest.raises(ValueError, match="gpt"):
        spec_for("gpt")


def test_usage_is_read_off_a_response():
    message = SimpleNamespace(
        usage=SimpleNamespace(
            input_tokens=10,
            output_tokens=20,
            cache_read_input_tokens=5,
            cache_creation_input_tokens=2,
        )
    )
    assert usage_from(message) == Usage(10, 20, 5, 2)


def test_missing_cache_fields_read_as_zero():
    """Responses that used no caching omit the fields, or carry None."""
    message = SimpleNamespace(
        usage=SimpleNamespace(input_tokens=10, output_tokens=20, cache_read_input_tokens=None)
    )
    assert usage_from(message) == Usage(10, 20, 0, 0)


@pytest.mark.parametrize(
    "model_key,expected",
    [
        # 1M input + 1M output at the published rates.
        ("haiku", Decimal("6.00")),
        ("sonnet", Decimal("12.00")),
        ("opus", Decimal("30.00")),
    ],
)
def test_cost_follows_the_published_rates(model_key, expected):
    usage = Usage(input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost_usd(model_key, usage) == expected


def test_cache_reads_are_a_tenth_and_writes_a_quarter_more():
    # 1M cache reads on haiku ($1/MTok input) => $0.10; 1M writes => $1.25.
    assert cost_usd("haiku", Usage(cache_read_input_tokens=1_000_000)) == Decimal("0.10")
    assert cost_usd("haiku", Usage(cache_creation_input_tokens=1_000_000)) == Decimal("1.25")


def test_a_typical_call_rounds_to_the_microdollar():
    assert cost_usd("opus", Usage(input_tokens=1234, output_tokens=567)) == Decimal("0.020345")


def test_haiku_sends_nothing_beyond_the_model_and_ceiling():
    """No thinking and no effort control, so the defaults are the whole request."""
    for structured in (True, False):
        params = request_params("haiku", structured=structured, max_tokens=4096)
        assert params == {"model": "claude-haiku-4-5", "max_tokens": 4096}


@pytest.mark.parametrize("model_key", ["haiku", "sonnet", "opus"])
def test_no_model_is_sent_a_sampling_parameter(model_key):
    """Sonnet 5 and Opus 5 removed sampling parameters — sending one is a 400 —
    and Haiku is left on the defaults rather than diverging from them."""
    for structured in (True, False):
        params = request_params(model_key, structured=structured, max_tokens=4096)
        assert not {"temperature", "top_p", "top_k"} & params.keys()


@pytest.mark.parametrize("model_key", ["sonnet", "opus"])
def test_thinking_models_get_headroom_for_prose(model_key):
    """Thinking tokens come out of max_tokens, so a chapter drafted at the bare
    4096 ceiling could be cut off before the prose starts."""
    params = request_params(model_key, structured=False, max_tokens=4096)
    assert params["max_tokens"] > 4096
    assert params["output_config"] == {"effort": "low"}
    assert "thinking" not in params


@pytest.mark.parametrize("model_key", ["sonnet", "opus"])
def test_thinking_is_off_for_forced_tool_calls(model_key):
    params = request_params(model_key, structured=True, max_tokens=1024)
    assert params["thinking"] == {"type": "disabled"}
    assert params["max_tokens"] == 1024
