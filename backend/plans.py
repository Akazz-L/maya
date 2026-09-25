"""The plans a writer can be on, and the monthly AI budget each one buys.

Free needs no payment. Each paid plan is a monthly Stripe price, named by
STRIPE_PRICE_<KEY>. A paid plan whose price is not configured is not offered,
so a deployment without Stripe runs with Free alone.

A plan's AI budget is its own setting, PLAN_<KEY>_BUDGET_USD, rather than its
price: the difference covers payment fees and hosting, and it can be tuned
without a deploy. The price shown is for display and must match Stripe's.
"""

import os
from dataclasses import dataclass
from decimal import Decimal

from backend.settings import get_monthly_budget_micro_usd, get_stripe_secret_key

FREE_KEY = "free"


@dataclass(frozen=True)
class Plan:
    key: str
    label: str
    price_usd: int
    budget_micro_usd: int
    #: The Stripe price a subscription to this plan is for; None for Free.
    stripe_price_id: str | None = None

    @property
    def is_paid(self) -> bool:
        return self.stripe_price_id is not None


# key, label, price in USD, default AI budget in USD.
_PAID = (
    ("starter", "Starter", 20, "10.00"),
    ("pro", "Pro", 50, "25.00"),
    ("studio", "Studio", 100, "50.00"),
)


def free_plan() -> Plan:
    return Plan(
        key=FREE_KEY,
        label="Free",
        price_usd=0,
        budget_micro_usd=get_monthly_budget_micro_usd(),
    )


def paid_plans() -> list[Plan]:
    """The paid plans on offer, cheapest first. Empty while billing is off."""
    if not get_stripe_secret_key():
        return []
    plans = []
    for key, label, price_usd, default_budget in _PAID:
        price_id = os.getenv(f"STRIPE_PRICE_{key.upper()}")
        if not price_id:
            continue
        budget = Decimal(os.getenv(f"PLAN_{key.upper()}_BUDGET_USD", default_budget))
        plans.append(
            Plan(
                key=key,
                label=label,
                price_usd=price_usd,
                budget_micro_usd=int(budget * 1_000_000),
                stripe_price_id=price_id,
            )
        )
    return plans


def all_plans() -> list[Plan]:
    return [free_plan(), *paid_plans()]


def paid_plan(key: str) -> Plan | None:
    return next((p for p in paid_plans() if p.key == key), None)


def plan_for_price(stripe_price_id: str) -> Plan | None:
    return next((p for p in paid_plans() if p.stripe_price_id == stripe_price_id), None)
