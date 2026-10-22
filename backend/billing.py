"""Stripe: customers, checkout, the billing portal, and mirroring subscriptions.

Stripe is the source of truth for what a writer pays for. `sync_customer`
copies a customer's subscriptions from Stripe as they are now, and it is the
only writer of the subscriptions table: webhooks and the return from checkout
both call it, so neither the order events arrive in nor a slow webhook can
leave a writer on the wrong plan.
"""

from datetime import datetime, timezone

import stripe
from clerk_backend_api import Clerk
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db_models import Subscription, User
from backend.plans import Plan
from backend.settings import get_app_url, get_clerk_secret_key, get_stripe_secret_key


class BillingDisabled(Exception):
    """STRIPE_SECRET_KEY is not set."""


def stripe_client() -> stripe.StripeClient:
    key = get_stripe_secret_key()
    if not key:
        raise BillingDisabled
    return stripe.StripeClient(key)


def _at(timestamp: int | None) -> datetime | None:
    return None if timestamp is None else datetime.fromtimestamp(timestamp, timezone.utc)


async def _email_for(user: User) -> str | None:
    async with Clerk(bearer_auth=get_clerk_secret_key()) as clerk:
        account = await clerk.users.get_async(user_id=user.clerk_user_id)
    primary = next(
        (e for e in account.email_addresses if e.id == account.primary_email_address_id),
        None,
    )
    return primary.email_address if primary else None


async def ensure_customer(db: AsyncSession, user: User) -> str:
    """The writer's Stripe customer, created on their first checkout."""
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer = await stripe_client().v1.customers.create_async(
        {
            "email": await _email_for(user),
            "metadata": {"maya_user_id": str(user.id), "clerk_user_id": user.clerk_user_id},
        },
        # Two checkouts started at once get the same customer back rather than two.
        {"idempotency_key": f"maya-customer-{user.id}"},
    )
    user.stripe_customer_id = customer.id
    await db.commit()
    return customer.id


async def checkout_url(db: AsyncSession, user: User, plan: Plan) -> str:
    customer = await ensure_customer(db, user)
    app = get_app_url()
    session = await stripe_client().v1.checkout.sessions.create_async(
        {
            "mode": "subscription",
            "customer": customer,
            "client_reference_id": str(user.id),
            "line_items": [{"price": plan.stripe_price_id, "quantity": 1}],
            "allow_promotion_codes": True,
            "success_url": f"{app}/plans?checkout=success",
            "cancel_url": f"{app}/plans",
        }
    )
    return session.url


async def portal_url(user: User) -> str:
    """Stripe's billing portal, where a subscriber changes plan, updates their
    card, sees invoices, or cancels."""
    session = await stripe_client().v1.billing_portal.sessions.create_async(
        {"customer": user.stripe_customer_id, "return_url": f"{get_app_url()}/plans"}
    )
    return session.url


async def sync_customer(db: AsyncSession, user: User) -> None:
    """Rewrite the writer's subscriptions from Stripe's current state."""
    if not user.stripe_customer_id:
        return
    # A customer with more than a hundred subscriptions is not a case Maya creates.
    listed = await stripe_client().v1.subscriptions.list_async(
        {"customer": user.stripe_customer_id, "status": "all", "limit": 100}
    )
    existing = {
        row.stripe_subscription_id: row
        for row in (
            await db.execute(select(Subscription).where(Subscription.user_id == user.id))
        ).scalars()
    }
    for sub in listed.data:
        # A Maya subscription has exactly one item: the plan's price. Since API
        # version 2025-03-31 the billing period lives on the item. `items` is
        # read by key because the attribute name is taken by the dict method.
        item = sub["items"].data[0]
        row = existing.get(sub.id) or Subscription(user_id=user.id, stripe_subscription_id=sub.id)
        row.stripe_price_id = item.price.id
        row.status = sub.status
        row.current_period_start = _at(item.current_period_start)
        row.current_period_end = _at(item.current_period_end)
        # Cancelling "at period end" shows up as cancel_at_period_end on some
        # paths and as a cancel_at date on others; both mean it stops renewing.
        cancel_at = sub.cancel_at
        if cancel_at is None and sub.cancel_at_period_end:
            cancel_at = item.current_period_end
        row.cancel_at = _at(cancel_at)
        db.add(row)
    await db.commit()


async def user_for_customer(db: AsyncSession, customer_id: str) -> User | None:
    result = await db.execute(select(User).where(User.stripe_customer_id == customer_id))
    return result.scalar_one_or_none()
