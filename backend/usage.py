"""Monthly spend accounting and the budget gate.

Spend is summed over the current calendar month in UTC. A calendar month is
what the meter in the editor shows, and unlike a rolling window it gives the
writer a reset date to read.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth import get_current_user
from backend.db import get_db
from backend.db_models import UsageEvent, User
from backend.llm import Usage, cost_usd
from backend.settings import get_monthly_budget_micro_usd

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


@dataclass(frozen=True)
class UsageSnapshot:
    spent_usd: Decimal
    budget_usd: Decimal
    percent: float
    blocked: bool
    #: When the meter resets — the first instant of next month, UTC.
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


def budget_micro_usd(user: User) -> int:
    budget = user.monthly_budget_micro_usd
    return get_monthly_budget_micro_usd() if budget is None else budget


async def spent_micro_usd(db: AsyncSession, user_id: uuid.UUID, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(func.coalesce(func.sum(UsageEvent.cost_micro_usd), 0)).where(
            UsageEvent.user_id == user_id,
            UsageEvent.created_at >= month_start(now),
        )
    )
    return int(result.scalar_one())


async def snapshot(db: AsyncSession, user: User, now: datetime | None = None) -> UsageSnapshot:
    now = now or datetime.now(timezone.utc)
    spent = await spent_micro_usd(db, user.id, now)
    budget = budget_micro_usd(user)
    # A zero or negative budget means no AI at all, rather than a division by zero.
    percent = round(spent / budget * 100, 1) if budget > 0 else 100.0
    return UsageSnapshot(
        spent_usd=Decimal(spent) / _MICRO,
        budget_usd=Decimal(budget) / _MICRO,
        percent=percent,
        blocked=spent >= budget,
        period_end=next_month_start(now),
    )


class Meter:
    """Collects the usage one request accrues and writes it in a single commit.

    Nothing touches the session until `flush`, because the summarizer fans out
    under asyncio.gather and AsyncSession is not concurrency-safe.
    """

    def __init__(self, db: AsyncSession, user: User, model_key: str):
        self._db = db
        self._user = user
        self._model_key = model_key
        self._events: list[tuple[str, Usage]] = []

    def add(self, operation: str, usage: Usage) -> None:
        self._events.append((operation, usage))

    async def flush(self) -> None:
        """Write the collected usage and commit.

        Always commits, even with nothing collected, so a caller can use this
        in place of the `db.commit()` that persists its own changes rather than
        having to remember both.
        """
        for operation, usage in self._events:
            self._db.add(
                UsageEvent(
                    user_id=self._user.id,
                    model_key=self._model_key,
                    operation=operation,
                    input_tokens=usage.input_tokens,
                    output_tokens=usage.output_tokens,
                    cache_read_input_tokens=usage.cache_read_input_tokens,
                    cache_creation_input_tokens=usage.cache_creation_input_tokens,
                    cost_micro_usd=int(cost_usd(self._model_key, usage) * _MICRO),
                )
            )
        self._events.clear()
        await self._db.commit()

    async def snapshot(self) -> UsageSnapshot:
        return await snapshot(self._db, self._user)


async def require_ai_budget(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Refuse to start any generation once the month's budget is spent.

    Pre-flight only: a call already under way always runs to completion, so a
    writer can overshoot by at most one call and never loses a draft mid-stream.
    Because this runs before the StreamingResponse is constructed, a blocked
    stream fails as a plain 402 body rather than an error frame inside an
    otherwise-successful SSE response.
    """
    current = await snapshot(db, current_user)
    if current.blocked:
        raise HTTPException(
            status_code=402,
            detail=(
                f"AI budget for this month is used up "
                f"({format_usd(current.spent_usd)} of {format_usd(current.budget_usd)}). "
                f"It resets on {current.period_end:%b %-d}."
            ),
        )
    return current_user
