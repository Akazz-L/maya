import os
from decimal import Decimal

from dotenv import load_dotenv

load_dotenv()

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


def get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET environment variable is not set")
    return secret


def get_jwt_expire_minutes() -> int:
    return int(os.getenv("JWT_EXPIRE_MINUTES", "10080"))
