import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend import billing
from backend.auth import get_current_user
from backend.db import get_db
from backend.db_models import User
from backend.plans import Plan, all_plans, paid_plan
from backend.settings import get_stripe_secret_key, get_stripe_webhook_secret
from backend.usage import entitlement

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


class PlanOption(BaseModel):
    key: str
    label: str
    price_usd: int
    budget_usd: float


class CheckoutRequest(BaseModel):
    plan: str


class RedirectResponse(BaseModel):
    url: str


def plan_option(plan: Plan) -> PlanOption:
    return PlanOption(
        key=plan.key,
        label=plan.label,
        price_usd=plan.price_usd,
        budget_usd=plan.budget_micro_usd / 1_000_000,
    )


@router.get("/plans", response_model=list[PlanOption])
def list_plans(current_user: User = Depends(get_current_user)):
    """Free, then each paid plan on offer, cheapest first."""
    return [plan_option(p) for p in all_plans()]


@router.post("/checkout", response_model=RedirectResponse)
async def start_checkout(
    body: CheckoutRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """A Stripe Checkout page subscribing the writer to a paid plan."""
    if not get_stripe_secret_key():
        raise billing.BillingDisabled
    plan = paid_plan(body.plan)
    if plan is None:
        raise HTTPException(status_code=422, detail=f"No paid plan called {body.plan!r}.")
    if (await entitlement(db, current_user)).plan.is_paid:
        # A second subscription would bill twice; plan changes go through the
        # portal, which swaps the price on the existing one and prorates.
        raise HTTPException(
            status_code=409,
            detail="You already have a paid plan. Use Manage billing to change it.",
        )
    return RedirectResponse(url=await billing.checkout_url(db, current_user, plan))


@router.post("/portal", response_model=RedirectResponse)
async def open_portal(current_user: User = Depends(get_current_user)):
    if not current_user.stripe_customer_id:
        raise HTTPException(status_code=409, detail="There is no billing account to manage yet.")
    return RedirectResponse(url=await billing.portal_url(current_user))


@router.post("/sync", status_code=204)
async def sync(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Refresh the writer's plan from Stripe now, for the return from checkout
    or the portal, when the webhook may not have landed yet."""
    await billing.sync_customer(db, current_user)


@router.post("/webhook", status_code=204)
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    secret = get_stripe_webhook_secret()
    if not secret:
        raise HTTPException(status_code=503, detail="Billing webhooks are not configured.")
    try:
        event = billing.stripe_client().construct_event(
            await request.body(), request.headers.get("stripe-signature"), secret
        )
    except (ValueError, stripe.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    if not event.type.startswith("customer.subscription."):
        return
    customer_id = event.data.object.customer
    user = await billing.user_for_customer(db, customer_id)
    if user is None:
        # Not a Maya customer: Stripe accounts are often shared with other products.
        _logger.info("Ignoring %s for unknown customer %s", event.type, customer_id)
        return
    await billing.sync_customer(db, user)
