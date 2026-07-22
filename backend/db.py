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
    """Verify the schema has been migrated. Alembic is the only thing that
    writes DDL; this deliberately does not call create_all, which would be a
    second, competing source of schema truth.

    Checks for alembic_version rather than creating anything, so a database
    that was never migrated fails at startup with an actionable message
    instead of "no such table: users" on the first request.
    """
    from sqlalchemy import inspect

    engine, _ = _get_engine()
    async with engine.connect() as conn:
        migrated = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).has_table("alembic_version")
        )
    if not migrated:
        raise RuntimeError(
            "Database schema is not initialized. Run `make migrate` "
            "(alembic upgrade head) before starting the app."
        )
