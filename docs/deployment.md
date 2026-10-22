# Deploying and keeping secrets

Notes to follow when Maya is first deployed.
The README mentions Railway as a possible host; the platform-specific steps below are the standard setup and have not been checked against a real deploy.

## Where configuration lives

The app reads all its settings from environment variables, so the same code runs everywhere and only the environment differs.

| Environment | Where the settings live |
|---|---|
| Local | `.env`, gitignored, with test values only. `.env.example` is committed with placeholders. |
| Production | The hosting platform's secret store, injected as environment variables at runtime. |

Do not create a `.env.production` file.
Production secrets should not sit in a file on a laptop or in the repository.

## Which values are secret

| Variable | Secret? | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | |
| `CLERK_SECRET_KEY` | Yes | Use the production Clerk instance's key. |
| `VITE_CLERK_PUBLISHABLE_KEY` | No | Public by design: it ships in the frontend bundle. |
| `CLERK_AUTHORIZED_PARTIES` | No | The public URL the app is served from. Required with a live Clerk key. |
| `STRIPE_SECRET_KEY` | Yes | See below. |
| `STRIPE_WEBHOOK_SECRET` | Yes | From the live webhook endpoint, not from the Stripe CLI. |
| `STRIPE_PRICE_STARTER`, `_PRO`, `_STUDIO` | No | The live-mode price ids. |
| `APP_URL` | No | The public HTTPS URL, used for checkout and portal return links. |
| `DATABASE_URL` | Yes | |

## Stripe: going live

Test mode and live mode are separate worlds inside the same Stripe account.
Nothing created in test mode exists in live mode.

1. Complete the Stripe account activation: business details, identity verification and a payout bank account.
   Until then, live keys cannot take real payments.
2. In live mode, repeat the setup in [`billing.md`](billing.md#setting-up-stripe): one product and monthly price per plan, the customer portal settings, and the webhook endpoint.
3. The webhook endpoint is `https://<your domain>/billing/webhook`, for `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`.
   Nothing runs `stripe listen` in production: Stripe calls the endpoint directly, and the route is part of the FastAPI app.
4. Put the live values in the platform's secret store: the live key, the endpoint's `whsec_…`, the three live price ids and `APP_URL`.
5. Make sure the webhook route is reachable from outside, with nothing in front of the app blocking `/billing/webhook`.
6. Check the first payment with a real card on the cheapest plan, then refund it in the dashboard.

Common mistakes are reusing a test value in production, and using the CLI's `whsec_…` instead of the live endpoint's.
Either one makes checkout or every webhook fail.

## Handling the Stripe keys

- Prefer a restricted key (`rk_live_…`) over the full `sk_live_…`.
  Grant it only what the app uses: Checkout sessions, customers, billing portal sessions and subscriptions.
  If it leaks, the damage is limited.
- Never put live keys in a local `.env`, in chat, in logs or in CI output.
- Rotate a key if it is exposed.
  Stripe can roll a key with a grace period, after which the platform variable is updated.
- Use two-factor authentication and role-based access on the Stripe dashboard.
- Limit who can read the production variables on the platform.

## Separating environments

- Local, staging and production each get their own Stripe mode or account, Clerk instance and database.
- Staging can use Stripe test mode against a public URL.
  That is the one case where a test-mode webhook endpoint is registered in the dashboard.
- Never point a non-production environment at production data.

## Safeguards worth adding

These are not implemented yet.

- Refuse to start when `STRIPE_SECRET_KEY` is a live key but the webhook secret or the price ids are missing.
  `lifespan` in `backend/main.py` already does this for Clerk.
- Refuse to start when a `sk_live_` key is combined with test price ids, or the reverse.
  A mismatch fails every checkout.

## When to move to a secrets manager

For one app on one platform, the platform's variables are enough.
Move to a dedicated manager (AWS Secrets Manager, Doppler, 1Password) once there are several services, several teams, or compliance requirements.
