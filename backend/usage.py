"""Spend accounting, the plan in effect, and the budget gate.

Spend is summed over the current budget period. On Free that is the calendar
month in UTC; on a paid plan it is the Stripe billing period, so the budget
resets on the day the writer is charged. Either way the writer has a reset
date to read, which a rolling window would not give them.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import get_current_user
from backend.db import get_db
from backend.db_models import Subscription, UsageEvent, User
from backend.llm import Usage, cost_usd
from backend.plans import Plan, free_plan, paid_plans, plan_for_price

_MICRO = Decimal(1_000_000)


def month_start(now: datetime) -> datetime:
    return now.astimezone(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )


def next_month_start(now: datetime) -> datetime:
    start = month_start(now)
    if start.month == 12:
        return start.replace(year=start.year + 1, month=1)
    return start.replace(month=start.month + 1)


def _utc(moment: datetime) -> datetime:
    """SQLite hands timestamps back without their zone; every one stored is UTC."""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


#: Stripe statuses that pay for the plan. A cancelled subscription stays
#: "active" until its period ends, so it keeps its budget until then. A failed
#: renewal turns it "past_due", which counts as Free: the payment that failed
#: was for the period just starting.
PAID_STATUSES = ("active", "trialing")


@dataclass(frozen=True)
class Entitlement:
    """The plan in effect and the budget period it sets."""

    plan: Plan
    budget_micro_usd: int
    period_start: datetime
    period_end: datetime
    #: When a paid plan stops renewing; None while it renews, and on Free.
    ends_at: datetime | None = None


async def entitlement(db: AsyncSession, user: User, now: datetime | None = None) -> Entitlement:
    now = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(Subscription).where(
            Subscription.user_id == user.id,
            Subscription.status.in_(PAID_STATUSES),
            Subscription.current_period_start <= now,
            Subscription.current_period_end > now,
        )
    )
    paying = [
        (plan, sub)
        for sub in result.scalars()
        if (plan := plan_for_price(sub.stripe_price_id)) is not None
    ]
    # A per-user override replaces the plan's budget, whatever the plan.
    override = user.monthly_budget_micro_usd
    if paying:
        plan, sub = max(paying, key=lambda pair: pair[0].budget_micro_usd)
        return Entitlement(
            plan=plan,
            budget_micro_usd=plan.budget_micro_usd if override is None else override,
            period_start=_utc(sub.current_period_start),
            period_end=_utc(sub.current_period_end),
            ends_at=_utc(sub.cancel_at) if sub.cancel_at else None,
        )
    plan = free_plan()
    return Entitlement(
        plan=plan,
        budget_micro_usd=plan.budget_micro_usd if override is None else override,
        period_start=month_start(now),
        period_end=next_month_start(now),
    )


@dataclass(frozen=True)
class UsageSnapshot:
    spent_usd: Decimal
    budget_usd: Decimal
    percent: float
    blocked: bool
    #: When the meter resets: the next billing date on a paid plan, or the
    #: first instant of next month (UTC) on Free.
    period_end: datetime

    def as_dict(self) -> dict:
        return {
            "spent_usd": float(self.spent_usd),
            "budget_usd": float(self.budget_usd),
            "percent": self.percent,
            "blocked": self.blocked,
            "period_end": self.period_end.isoformat(),
        }


def format_usd(amount: Decimal) -> str:
    """Render a dollar amount for a person to read.

    Sub-cent amounts round to "$0.00" under plain 2dp formatting, which turns a
    refusal into nonsense ("$0.00 of $0.00") whenever a budget is set very low.
    Matches the editor's meter.
    """
    if 0 < amount < Decimal("0.01"):
        return "<$0.01"
    return f"${amount:.2f}"


async def spent_micro_usd(db: AsyncSession, user_id: uuid.UUID, since: datetime) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(UsageEvent.cost_micro_usd), 0)).where(
            UsageEvent.user_id == user_id,
            UsageEvent.created_at >= since,
        )
    )
    return int(result.scalar_one())


async def snapshot(
    db: AsyncSession,
    user: User,
    now: datetime | None = None,
    current: Entitlement | None = None,
) -> UsageSnapshot:
    now = now or datetime.now(timezone.utc)
    current = current or await entitlement(db, user, now)
    spent = await spent_micro_usd(db, user.id, current.period_start)
    budget = current.budget_micro_usd
    # A zero or negative budget means no AI at all, rather than a division by zero.
    percent = round(spent / budget * 100, 1) if budget > 0 else 100.0
    return UsageSnapshot(
        spent_usd=Decimal(spent) / _MICRO,
        budget_usd=Decimal(budget) / _MICRO,
        percent=percent,
        blocked=spent >= budget,
        period_end=current.period_end,
    )


class Meter:
    """Collects the usage one request accrues and writes it in a single commit.

    Nothing touches the session until `flush`, because the summarizer fans out
    under asyncio.gather and AsyncSession is not concurrency-safe.
    """

    def __init__(self, db: AsyncSession, user: User, model_key: str):
        self._db = db
        self._user = user
        # Read once: a failed commit rolls the session back and expires `user`,
        # and reloading an expired attribute is not possible under AsyncSession.
        self._user_id = user.id
        self._model_key = model_key
        self._events: list[tuple[str, Usage]] = []

    def add(self, operation: str, usage: Usage) -> None:
        self._events.append((operation, usage))

    @asynccontextmanager
    async def flushed_on_error(self) -> AsyncIterator[None]:
        """Write what was collected if the block raises, then let it raise.

        For the stretch of a request before its own result exists: a summary
        refreshed there was billed whether or not the generation after it
        succeeds.
        """
        try:
            yield
        except Exception:
            await self.flush()
            raise

    async def flush(self) -> None:
        """Write the collected usage and commit.

        Always commits, even with nothing collected, so a caller can use this
        in place of the `db.commit()` that persists its own changes rather than
        having to remember both.

        The collected usage is kept until the commit succeeds. A failed commit
        rolls the session back, so a later flush writes the same rows again
        rather than finding them gone: every one of them was a billed call.
        """
        for operation, usage in self._events:
            self._db.add(
                UsageEvent(
                    user_id=self._user_id,
                    model_key=self._model_key,
                    operation=operation,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_input_tokens=usage.cache_read_input_tokens,
                    cache_creation_input_tokens=usage.cache_creation_input_tokens,
                    cost_micro_usd=int(cost_usd(self._model_key, usage) * _MICRO),
                )
            )
        try:
            await self._db.commit()
        except BaseException:
            await self._db.rollback()
            raise
        self._events.clear()

    async def snapshot(self) -> UsageSnapshot:
        return await snapshot(self._db, self._user)


async def require_ai_budget(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Refuse to start any generation once the period's budget is spent.

    Pre-flight only: a call already under way always runs to completion, so a
    writer never loses a draft mid-stream. The check reads the ledger without
    reserving anything, and a call's cost lands only when it finishes, so every
    request that starts under the cap is allowed through. The overshoot is
    therefore bounded by the requests a writer has in flight at once (one call
    each, plus the summaries it refreshes), not by a single call.
    Because this runs before the StreamingResponse is constructed, a blocked
    stream fails as a plain 402 body rather than an error frame inside an
    otherwise-successful SSE response.
    """
    current = await snapshot(db, current_user)
    if current.blocked:
        detail = (
            f"AI budget for this period is used up "
            f"({format_usd(current.spent_usd)} of {format_usd(current.budget_usd)}). "
            f"It resets on {current.period_end:%b %-d}."
        )
        if any(p.budget_micro_usd > current.budget_usd * _MICRO for p in paid_plans()):
            detail += " Upgrade your plan to keep going now."
        raise HTTPException(status_code=402, detail=detail)
    return current_user
