"""Auth routes: signup, login, current user."""

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.deps.auth import bearer_scheme, get_current_user
from app.models.user import User
from app.schemas.auth import LoginRequest, SignupRequest, TokenResponse, UserOut
from app.services.auth import (
    EmailAlreadyExistsError,
    authenticate_user,
    create_user,
)
from app.services.cache import CacheStore, get_cache_store
from app.services.events import record_event
from app.services.sessions import create_session, revoke_session

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


async def enforce_auth_rate_limit(
    request: Request, cache: CacheStore = Depends(get_cache_store)
) -> None:
    client = request.client.host if request.client else "unknown"
    count = await cache.increment(f"rate:auth:{client}", 60)
    if count > settings.auth_rate_limit_per_minute:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many auth attempts")


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    payload: SignupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
    _: None = Depends(enforce_auth_rate_limit),
) -> TokenResponse:
    try:
        user = await create_user(db, payload)
    except EmailAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        ) from exc
    record_event(
        db,
        action="auth.user_signed_up",
        resource_type="user",
        resource_id=str(user.id),
        workspace_id=None,
        actor_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return TokenResponse(access_token=await create_session(cache, user.id))


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
    _: None = Depends(enforce_auth_rate_limit),
) -> TokenResponse:
    user = await authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    record_event(
        db,
        action="auth.user_logged_in",
        resource_type="user",
        resource_id=str(user.id),
        workspace_id=None,
        actor_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return TokenResponse(access_token=await create_session(cache, user.id))


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    cache: CacheStore = Depends(get_cache_store),
) -> None:
    try:
        payload = decode_access_token(credentials.credentials)
        session_id = payload.get("jti")
        if session_id:
            await revoke_session(cache, str(session_id))
    except jwt.PyJWTError:
        return
