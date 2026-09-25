from clerk_backend_api.security import authenticate_request_async
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.db_models import User
from backend.settings import (
    get_clerk_authorized_parties,
    get_clerk_jwt_key,
    get_clerk_secret_key,
)


async def verify_session(request: Request) -> str | None:
    """The Clerk user id behind the request's session token, or None."""
    state = await authenticate_request_async(
        request,
        AuthenticateRequestOptions(
            secret_key=get_clerk_secret_key(),
            jwt_key=get_clerk_jwt_key(),
            authorized_parties=get_clerk_authorized_parties(),
            accepts_token=["session_token"],
        ),
    )
    if not state.is_signed_in or not state.payload:
        return None
    return state.payload.get("sub")


async def get_or_create_user(db: AsyncSession, clerk_user_id: str) -> User:
    """The local row for a Clerk user, created on their first request."""
    query = select(User).where(User.clerk_user_id == clerk_user_id)
    user = (await db.execute(query)).scalar_one_or_none()
    if user is not None:
        return user
    user = User(clerk_user_id=clerk_user_id)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        # A concurrent first request inserted the same user; use its row.
        await db.rollback()
        return (await db.execute(query)).scalar_one()
    return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    clerk_user_id = await verify_session(request)
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await get_or_create_user(db, clerk_user_id)
