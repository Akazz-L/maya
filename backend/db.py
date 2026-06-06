from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_engine = None
_session_factory = None


def _get_engine():
    global _engine, _session_factory
    if _engine is None:
        from backend.settings import get_database_url
        _engine = create_async_engine(get_database_url(), echo=False)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine, _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    _, factory = _get_engine()
    async with factory() as session:
        yield session


async def init_db() -> None:
    """Create any missing tables. Idempotent — safe to call on every startup.
    Lets the app run against a fresh on-disk SQLite file with zero setup;
    for PostgreSQL you can still manage schema with `alembic upgrade head`."""
    from backend.db_models import Base

    engine, _ = _get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
