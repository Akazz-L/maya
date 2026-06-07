import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db import get_db
from backend.db_models import User
from backend.settings import get_jwt_expire_minutes, get_jwt_secret

_bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=get_jwt_expire_minutes())
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, get_jwt_secret(), algorithm="HS256")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        payload = jwt.decode(credentials.credentials, get_jwt_secret(), algorithms=["HS256"])
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise exc
    except JWTError:
        raise exc

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id_str)))
    user = result.scalar_one_or_none()
    if user is None:
        raise exc
    return user
