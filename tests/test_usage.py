from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import event

from backend.db_models import Subscription, UsageEvent, User
from backend.llm import Usage
from backend.usage import (
    Meter,
    entitlement,
    format_usd,
    month_start,
    next_month_start,
    snapshot,
    spent_micro_usd,
)

DOLLAR = 1_000_000
#: Before any spend a test writes, so a sum from here counts all of it.
EPOCH = datetime(2000, 1, 1, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def user(db):
    user = User(clerk_user_id="user_u")
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
    assert await spent_micro_usd(db, user.id, month_start(now)) == 1 * DOLLAR


@pytest.mark.asyncio
async def test_another_users_spend_is_not_counted(db, user):
    other = User(clerk_user_id="user_other")
    db.add(other)
    await db.commit()
    await _spend(db, other, 4 * DOLLAR)
    assert await spent_micro_usd(db, user.id, EPOCH) == 0


# ---------------------------------------------------------------------------
# The plan in effect
# ---------------------------------------------------------------------------

NOW = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
PERIOD_START = datetime(2026, 9, 14, tzinfo=timezone.utc)
PERIOD_END = datetime(2026, 10, 14, tzinfo=timezone.utc)


async def _subscribe(db, user, price="price_pro", status="active", **fields):
    values = {
        "current_period_start": PERIOD_START,
        "current_period_end": PERIOD_END,
        **fields,
    }
    db.add(
        Subscription(
            user_id=user.id,
            stripe_subscription_id=f"sub_{price}_{status}",
            stripe_price_id=price,
            status=status,
            **values,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_free_budget_runs_over_the_calendar_month(db, user, monkeypatch):
    monkeypatch.setenv("MONTHLY_BUDGET_USD", "5.00")
    current = await entitlement(db, user, NOW)
    assert current.plan.key == "free"
    assert current.budget_micro_usd == 5 * DOLLAR
    assert (current.period_start, current.period_end) == (
        datetime(2026, 9, 1, tzinfo=timezone.utc),
        datetime(2026, 10, 1, tzinfo=timezone.utc),
    )


@pytest.mark.asyncio
async def test_a_per_user_budget_overrides_the_plan(db, user, billing):
    user.monthly_budget_micro_usd = 20 * DOLLAR
    assert (await entitlement(db, user, NOW)).budget_micro_usd == 20 * DOLLAR
    await _subscribe(db, user)
    assert (await entitlement(db, user, NOW)).budget_micro_usd == 20 * DOLLAR


@pytest.mark.asyncio
async def test_an_active_subscription_sets_the_budget_and_billing_period(db, user, billing):
    await _subscribe(db, user, "price_pro")
    current = await entitlement(db, user, NOW)
    assert current.plan.key == "pro"
    assert current.budget_micro_usd == 25 * DOLLAR
    assert (current.period_start, current.period_end) == (PERIOD_START, PERIOD_END)
    assert current.ends_at is None


@pytest.mark.asyncio
async def test_a_cancelled_plan_keeps_its_budget_until_the_period_ends(db, user, billing):
    await _subscribe(db, user, cancel_at=PERIOD_END)
    current = await entitlement(db, user, NOW)
    assert current.plan.key == "pro"
    assert current.ends_at == PERIOD_END


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["past_due", "canceled", "unpaid", "incomplete", "paused"])
async def test_a_subscription_that_is_not_paid_up_counts_as_free(db, user, billing, status):
    await _subscribe(db, user, status=status)
    assert (await entitlement(db, user, NOW)).plan.key == "free"


@pytest.mark.asyncio
async def test_a_period_that_has_ended_counts_as_free(db, user, billing):
    """Until Stripe reports the renewal, the old period is all there is."""
    await _subscribe(db, user)
    assert (await entitlement(db, user, PERIOD_END)).plan.key == "free"


@pytest.mark.asyncio
async def test_a_price_no_longer_on_offer_counts_as_free(db, user, billing):
    await _subscribe(db, user, price="price_retired")
    assert (await entitlement(db, user, NOW)).plan.key == "free"


@pytest.mark.asyncio
async def test_two_live_subscriptions_give_the_larger_budget(db, user, billing):
    await _subscribe(db, user, "price_starter")
    await _subscribe(db, user, "price_studio")
    assert (await entitlement(db, user, NOW)).plan.key == "studio"


@pytest.mark.asyncio
async def test_a_paid_plan_counts_spend_from_its_billing_date(db, user, billing):
    await _subscribe(db, user)
    await _spend(db, user, 3 * DOLLAR, at=PERIOD_START - timedelta(minutes=1))
    await _spend(db, user, 1 * DOLLAR, at=PERIOD_START + timedelta(minutes=1))
    current = await snapshot(db, user, NOW)
    assert current.spent_usd == Decimal("1")
    assert current.period_end == PERIOD_END


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
    assert await spent_micro_usd(db, user.id, EPOCH) == 30 * DOLLAR


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
    assert await spent_micro_usd(db, user.id, EPOCH) == 1 * DOLLAR


@pytest.mark.asyncio
async def test_a_failed_commit_keeps_the_usage_for_the_next_flush(db, user):
    """Every collected event was a billed call. A commit that fails must leave
    them in place for a retry, and written once, not lost or doubled."""
    user_id = user.id  # the failed commit's rollback expires `user`
    meter = Meter(db, user, "haiku")
    meter.add("plan", Usage(input_tokens=1_000_000))

    # Fail at the database rather than mocking commit(), so the session ends up
    # where a real failure leaves it: pending rows discarded, rollback required.
    failures = iter([RuntimeError("db down")])

    def fail_first_insert(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO usage_events"):
            error = next(failures, None)
            if error is not None:
                raise error

    engine = db.bind.sync_engine
    event.listen(engine, "before_cursor_execute", fail_first_insert)
    try:
        with pytest.raises(RuntimeError, match="db down"):
            await meter.flush()
        await meter.flush()
    finally:
        event.remove(engine, "before_cursor_execute", fail_first_insert)

    assert await spent_micro_usd(db, user_id, EPOCH) == 1 * DOLLAR
