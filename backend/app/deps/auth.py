"""Authentication dependencies."""

import uuid

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.services.cache import CacheStore, get_cache_store

bearer_scheme = HTTPBearer(auto_error=True)

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
) -> User:
    try:
        payload = decode_access_token(credentials.credentials)
        subject = payload.get("sub")
        session_id = payload.get("jti")
        if subject is None or session_id is None:
            raise _credentials_error
        user_id = uuid.UUID(subject)
    except (jwt.PyJWTError, ValueError) as exc:
        raise _credentials_error from exc

    session_user_id = await cache.get(f"session:{session_id}")
    if session_user_id != str(user_id):
        raise _credentials_error
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _credentials_error
    return user
