from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from backend.db_models import UsageEvent, User
from backend.llm import Usage
from backend.usage import (
    Meter,
    budget_micro_usd,
    format_usd,
    month_start,
    next_month_start,
    snapshot,
    spent_micro_usd,
)

DOLLAR = 1_000_000


@pytest_asyncio.fixture
async def user(db):
    user = User(email="u@test.com", hashed_password="x")
    db.add(user)
    await db.commit()
    return user


async def _spend(db, user, micro, *, at=None):
    db.add(
        UsageEvent(
            user_id=user.id,
            model_key="haiku",
            operation="draft",
            cost_micro_usd=micro,
            **({"created_at": at} if at else {}),
        )
    )
    await db.commit()


# ---------------------------------------------------------------------------
# The month window
# ---------------------------------------------------------------------------

def test_month_start_is_the_first_instant_utc():
    assert month_start(datetime(2026, 9, 6, 14, 30, tzinfo=timezone.utc)) == datetime(
        2026, 9, 1, tzinfo=timezone.utc
    )


def test_month_start_normalises_other_timezones():
    """A UTC-4 timestamp early on the 1st still belongs to the previous month."""
    local = datetime(2026, 9, 1, 2, 0, tzinfo=timezone(timedelta(hours=4)))
    assert month_start(local) == datetime(2026, 8, 1, tzinfo=timezone.utc)


def test_december_rolls_into_january():
    assert next_month_start(datetime(2026, 12, 20, tzinfo=timezone.utc)) == datetime(
        2027, 1, 1, tzinfo=timezone.utc
    )


@pytest.mark.asyncio
async def test_spend_before_this_month_is_not_counted(db, user):
    now = datetime(2026, 9, 6, tzinfo=timezone.utc)
    await _spend(db, user, 3 * DOLLAR, at=datetime(2026, 8, 31, 23, 59, tzinfo=timezone.utc))
    await _spend(db, user, 1 * DOLLAR, at=datetime(2026, 9, 1, 0, 1, tzinfo=timezone.utc))
    assert await spent_micro_usd(db, user.id, now) == 1 * DOLLAR


@pytest.mark.asyncio
async def test_another_users_spend_is_not_counted(db, user):
    other = User(email="other@test.com", hashed_password="x")
    db.add(other)
    await db.commit()
    await _spend(db, other, 4 * DOLLAR)
    assert await spent_micro_usd(db, user.id) == 0


# ---------------------------------------------------------------------------
# Budget resolution
# ---------------------------------------------------------------------------

def test_budget_falls_back_to_the_global_default(user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    assert budget_micro_usd(user) == 5 * DOLLAR


def test_a_per_user_budget_overrides_the_default(user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    user.monthly_budget_micro_usd = 20 * DOLLAR
    assert budget_micro_usd(user) == 20 * DOLLAR


# ---------------------------------------------------------------------------
# The snapshot the editor renders
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_snapshot_reports_spend_as_a_percentage(db, user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    await _spend(db, user, 1_250_000)
    snap = await snapshot(db, user)
    assert snap.spent_usd == Decimal("1.25")
    assert snap.budget_usd == Decimal("5")
    assert snap.percent == 25.0
    assert snap.blocked is False


@pytest.mark.asyncio
async def test_reaching_the_budget_exactly_blocks(db, user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    await _spend(db, user, 5 * DOLLAR)
    snap = await snapshot(db, user)
    assert snap.percent == 100.0
    assert snap.blocked is True


@pytest.mark.asyncio
async def test_an_overshooting_call_reports_over_a_hundred_percent(db, user, monkeypatch):
    """Enforcement is pre-flight, so one in-flight call can carry a writer past
    the cap. The meter tells the truth about it rather than clamping."""
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    await _spend(db, user, 5_400_000)
    snap = await snapshot(db, user)
    assert snap.percent == 108.0
    assert snap.blocked is True


@pytest.mark.asyncio
async def test_a_zero_budget_blocks_rather_than_dividing_by_zero(db, user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "0")
    snap = await snapshot(db, user)
    assert snap.percent == 100.0
    assert snap.blocked is True


@pytest.mark.asyncio
async def test_period_end_is_the_next_reset(db, user):
    snap = await snapshot(db, user, now=datetime(2026, 9, 6, tzinfo=timezone.utc))
    assert snap.period_end == datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_sub_cent_amounts_do_not_render_as_zero():
    """A tiny budget would otherwise make a refusal read "$0.00 of $0.00"."""
    assert format_usd(Decimal("0.002476")) == "<$0.01"
    assert format_usd(Decimal("0")) == "$0.00"
    assert format_usd(Decimal("5")) == "$5.00"


# ---------------------------------------------------------------------------
# Meter
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_meter_writes_one_row_per_call_priced_at_the_chosen_model(db, user):
    meter = Meter(db, user, "opus")
    meter.add("summarize", Usage(input_tokens=1_000_000))
    meter.add("draft", Usage(output_tokens=1_000_000))
    await meter.flush()

    rows = (await db.execute(UsageEvent.__table__.select())).all()
    assert sorted(r.operation for r in rows) == ["draft", "summarize"]
    # $5/MTok in + $25/MTok out on opus.
    assert await spent_micro_usd(db, user.id) == 30 * DOLLAR


@pytest.mark.asyncio
async def test_meter_flush_commits_pending_work_even_with_nothing_metered(db, user):
    """Callers use flush() in place of db.commit(), so it has to persist their
    own changes whether or not any API call happened."""
    user.model_key = "opus"
    await Meter(db, user, "opus").flush()
    stored = await db.execute(
        User.__table__.select().where(User.__table__.c.id == user.id)
    )
    assert stored.one().model_key == "opus"


@pytest.mark.asyncio
async def test_meter_does_not_double_write_on_a_second_flush(db, user):
    meter = Meter(db, user, "haiku")
    meter.add("plan", Usage(input_tokens=1_000_000))
    await meter.flush()
    await meter.flush()
    assert await spent_micro_usd(db, user.id) == 1 * DOLLAR
