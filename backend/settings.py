import os
from decimal import Decimal

# `.env` is loaded by the package itself (see backend/__init__.py), so every
# getter below reads an environment that is already populated.

_DEFAULT_MONTHLY_BUDGET_USD = "5.00"


def get_monthly_budget_micro_usd() -> int:
    """Default monthly AI budget, in micro-dollars.

    The default for every user; a non-NULL User.monthly_budget_micro_usd
    overrides it. Read per call rather than cached at import so a redeploy with
    a new value takes effect without special handling in tests.
    """
    dollars = Decimal(os.getenv("MONTHLY_BUDGET_USD", _DEFAULT_MONTHLY_BUDGET_USD))
    return int(dollars * 1_000_000)


def get_database_url() -> str:
    # Default to an on-disk SQLite file so the app runs with zero setup and
    # persists data across restarts. Override with DATABASE_URL for PostgreSQL.
    url = os.getenv("DATABASE_URL")
    if not url:
        return "sqlite+aiosqlite:///./maya.db"
    return _normalize_async_url(url)


def _normalize_async_url(url: str) -> str:
    """Rewrite a stock Postgres URL to the asyncpg driver SQLAlchemy needs.

    Hosted providers (Railway, Heroku, Fly) hand out `postgres://` or
    `postgresql://`, both of which SQLAlchemy resolves to the *sync* psycopg2
    driver and then rejects under create_async_engine. Left alone this fails at
    startup with a confusing "InvalidRequestError: The asyncio extension
    requires an async driver". Anything already carrying an explicit `+driver`
    is passed through untouched.
    """
    scheme, sep, rest = url.partition("://")
    if not sep or "+" in scheme:
        return url
    if scheme in ("postgres", "postgresql"):
        return f"postgresql+asyncpg://{rest}"
    return url


def get_clerk_secret_key() -> str:
    key = os.getenv("CLERK_SECRET_KEY")
    if not key:
        raise RuntimeError("CLERK_SECRET_KEY environment variable is not set")
    return key


def get_clerk_jwt_key() -> str | None:
    """PEM public key from Clerk's API Keys page. When set, session tokens are
    verified without fetching Clerk's JWKS."""
    return os.getenv("CLERK_JWT_KEY") or None


_DEFAULT_AUTHORIZED_PARTIES = "http://localhost:5173,http://localhost:8000"


def get_clerk_authorized_parties() -> list[str]:
    """Origins a session token may have been minted for (its `azp` claim).

    A token issued to any other site on the same Clerk instance is refused.
    """
    raw = os.getenv("CLERK_AUTHORIZED_PARTIES", _DEFAULT_AUTHORIZED_PARTIES)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
