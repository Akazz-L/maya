"""Billing routes against a stand-in for Stripe's API.

Only the network calls are faked. Webhook signatures are made and checked with
Stripe's real scheme, and Stripe objects are real StripeObjects, so the code
reads them exactly as it reads Stripe's responses.
"""

import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
import stripe
from sqlalchemy import select

from backend import billing as billing_service
from backend.db_models import Subscription, User
from tests.conftest import TEST_CLERK_USER_ID

WEBHOOK_SECRET = "whsec_unit_tests_only"
NOW = datetime.now(timezone.utc)


def stripe_subscription(sub_id="sub_1", price="price_pro", status="active", **fields) -> stripe.Subscription:
    start, end = NOW - timedelta(days=3), NOW + timedelta(days=27)
    return stripe.Subscription.construct_from(
        {
            "id": sub_id,
            "object": "subscription",
            "customer": "cus_1",
            "status": status,
            "cancel_at": None,
            "cancel_at_period_end": False,
            "items": {
                "object": "list",
                "data": [
                    {
                        "id": f"si_{sub_id}",
                        "object": "subscription_item",
                        "price": {"id": price, "object": "price"},
                        "current_period_start": int(start.timestamp()),
                        "current_period_end": int(end.timestamp()),
                    }
                ],
            },
            **fields,
        },
        "sk_test",
    )


class FakeStripe:
    """The slice of StripeClient billing.py uses, recording each call."""

    def __init__(self):
        self.subscriptions: list[stripe.Subscription] = []
        self.calls: list[tuple[str, dict]] = []
        self.v1 = SimpleNamespace(
            customers=SimpleNamespace(create_async=self._create_customer),
            checkout=SimpleNamespace(sessions=SimpleNamespace(create_async=self._checkout)),
            billing_portal=SimpleNamespace(sessions=SimpleNamespace(create_async=self._portal)),
            subscriptions=SimpleNamespace(list_async=self._list_subscriptions),
        )

    async def _create_customer(self, params, options=None):
        self.calls.append(("customer", params))
        return SimpleNamespace(id="cus_1")

    async def _checkout(self, params):
        self.calls.append(("checkout", params))
        return SimpleNamespace(url="https://checkout.stripe.test/c/1")

    async def _portal(self, params):
        self.calls.append(("portal", params))
        return SimpleNamespace(url="https://billing.stripe.test/p/1")

    async def _list_subscriptions(self, params):
        self.calls.append(("list", params))
        return SimpleNamespace(data=self.subscriptions)

    def construct_event(self, payload, sig_header, secret):
        return stripe.Webhook.construct_event(payload, sig_header, secret)


@pytest.fixture
def fake_stripe(billing, monkeypatch):
    fake = FakeStripe()
    monkeypatch.setattr(billing_service, "stripe_client", lambda: fake)

    async def email_for(user):
        return "writer@example.com"

    monkeypatch.setattr(billing_service, "_email_for", email_for)
    return fake


@pytest_asyncio.fixture
async def client(api_client):
    api_client.headers["Authorization"] = f"Bearer {TEST_CLERK_USER_ID}"
    return api_client


async def _user(db) -> User:
    return (await db.execute(select(User).where(User.clerk_user_id == TEST_CLERK_USER_ID))).scalar_one()


def signed(event: dict, secret: str = WEBHOOK_SECRET) -> tuple[bytes, dict]:
    payload = json.dumps(event).encode()
    timestamp = int(time.time())
    signature = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return payload, {"Stripe-Signature": f"t={timestamp},v1={signature}"}


def subscription_event(customer="cus_1", kind="customer.subscription.updated") -> dict:
    return {
        "id": "evt_1",
        "object": "event",
        "type": kind,
        "data": {"object": {"id": "sub_1", "object": "subscription", "customer": customer}},
    }


# ---------------------------------------------------------------------------
# Plans
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_plans_list_free_then_each_paid_plan(client, fake_stripe):
    plans = (await client.get("/billing/plans")).json()
    assert [(p["key"], p["price_usd"], p["budget_usd"]) for p in plans] == [
        ("free", 0, 5.0),
        ("starter", 20, 10.0),
        ("pro", 50, 25.0),
        ("studio", 100, 50.0),
    ]


@pytest.mark.asyncio
async def test_a_plan_budget_is_configurable(client, fake_stripe, monkeypatch):
    monkeypatch.setenv("PLAN_PRO_BUDGET_USD", "32.50")
    plans = {p["key"]: p for p in (await client.get("/billing/plans")).json()}
    assert plans["pro"]["budget_usd"] == 32.5


@pytest.mark.asyncio
async def test_without_stripe_only_free_is_offered(client, monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    assert [p["key"] for p in (await client.get("/billing/plans")).json()] == ["free"]
    resp = await client.post("/billing/checkout", json={"plan": "pro"})
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_me_reports_the_free_plan_by_default(client, fake_stripe):
    me = (await client.get("/me")).json()
    assert me["plan"] == {"key": "free", "label": "Free", "ends_at": None}


# ---------------------------------------------------------------------------
# Checkout and the portal
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_checkout_creates_the_customer_once_and_subscribes_to_the_plan(client, db, fake_stripe):
    resp = await client.post("/billing/checkout", json={"plan": "pro"})
    assert resp.status_code == 200
    assert resp.json() == {"url": "https://checkout.stripe.test/c/1"}

    await client.post("/billing/checkout", json={"plan": "studio"})
    kinds = [kind for kind, _ in fake_stripe.calls]
    assert kinds == ["customer", "checkout", "checkout"]
    assert fake_stripe.calls[0][1]["email"] == "writer@example.com"

    session = fake_stripe.calls[1][1]
    assert session["customer"] == "cus_1"
    assert session["mode"] == "subscription"
    assert session["line_items"] == [{"price": "price_pro", "quantity": 1}]
    assert session["success_url"].endswith("/plans?checkout=success")
    assert (await _user(db)).stripe_customer_id == "cus_1"


@pytest.mark.asyncio
async def test_checkout_refuses_an_unknown_plan(client, fake_stripe):
    for plan in ("free", "platinum"):
        assert (await client.post("/billing/checkout", json={"plan": plan})).status_code == 422


@pytest.mark.asyncio
async def test_checkout_refuses_a_second_paid_plan(client, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    fake_stripe.subscriptions = [stripe_subscription()]
    await client.post("/billing/sync")

    resp = await client.post("/billing/checkout", json={"plan": "studio"})
    assert resp.status_code == 409
    assert "Manage billing" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_the_portal_needs_a_billing_account(client, fake_stripe):
    assert (await client.post("/billing/portal")).status_code == 409

    await client.post("/billing/checkout", json={"plan": "pro"})
    resp = await client.post("/billing/portal")
    assert resp.json() == {"url": "https://billing.stripe.test/p/1"}
    assert fake_stripe.calls[-1][1]["return_url"].endswith("/plans")


# ---------------------------------------------------------------------------
# Mirroring subscriptions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_puts_the_writer_on_the_plan_they_pay_for(client, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    fake_stripe.subscriptions = [stripe_subscription(price="price_pro")]

    assert (await client.post("/billing/sync")).status_code == 204

    me = (await client.get("/me")).json()
    assert me["plan"]["key"] == "pro"
    assert me["usage"]["budget_usd"] == 25.0


@pytest.mark.asyncio
async def test_a_cancelled_subscription_reports_when_it_ends(client, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    ends = int((NOW + timedelta(days=27)).timestamp())
    fake_stripe.subscriptions = [stripe_subscription(cancel_at=ends)]
    await client.post("/billing/sync")

    plan = (await client.get("/me")).json()["plan"]
    assert plan["key"] == "pro"
    assert datetime.fromisoformat(plan["ends_at"]).timestamp() == ends


@pytest.mark.asyncio
async def test_cancel_at_period_end_is_read_as_ending_with_the_period(client, db, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    fake_stripe.subscriptions = [stripe_subscription(cancel_at_period_end=True)]
    await client.post("/billing/sync")

    row = (await db.execute(select(Subscription))).scalar_one()
    assert row.cancel_at == row.current_period_end


@pytest.mark.asyncio
async def test_sync_rewrites_rather_than_duplicates(client, db, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    fake_stripe.subscriptions = [stripe_subscription(status="active")]
    await client.post("/billing/sync")
    fake_stripe.subscriptions = [stripe_subscription(status="canceled")]
    await client.post("/billing/sync")

    rows = (await db.execute(select(Subscription))).scalars().all()
    assert [r.status for r in rows] == ["canceled"]
    assert (await client.get("/me")).json()["plan"]["key"] == "free"


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_subscription_webhook_syncs_that_customer(client, fake_stripe):
    await client.post("/billing/checkout", json={"plan": "pro"})
    fake_stripe.subscriptions = [stripe_subscription(price="price_studio")]

    payload, headers = signed(subscription_event())
    resp = await client.post("/billing/webhook", content=payload, headers=headers)

    assert resp.status_code == 204
    assert (await client.get("/me")).json()["plan"]["key"] == "studio"


@pytest.mark.asyncio
async def test_a_webhook_with_a_bad_signature_is_refused(client, fake_stripe):
    payload, headers = signed(subscription_event(), secret="whsec_someone_else")
    resp = await client.post("/billing/webhook", content=payload, headers=headers)
    assert resp.status_code == 400
    assert ("list", {"customer": "cus_1", "status": "all", "limit": 100}) not in fake_stripe.calls


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "event",
    [
        pytest.param(subscription_event(customer="cus_not_maya"), id="unknown-customer"),
        pytest.param(subscription_event(kind="invoice.paid"), id="other-event"),
    ],
)
async def test_webhooks_maya_does_not_act_on_are_acknowledged(client, fake_stripe, event):
    await client.post("/billing/checkout", json={"plan": "pro"})
    payload, headers = signed(event)
    resp = await client.post("/billing/webhook", content=payload, headers=headers)
    assert resp.status_code == 204
    assert not any(kind == "list" for kind, _ in fake_stripe.calls)
