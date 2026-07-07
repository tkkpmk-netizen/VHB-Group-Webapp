"""Auth routes: signup, login, current user."""

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.deps.auth import bearer_scheme, get_current_user
from app.models.user import IdentityAccount, User
from app.schemas.auth import (
    GoogleCredentialRequest,
    IdentityOut,
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from app.services.auth import (
    EmailAlreadyExistsError,
    authenticate_user,
    create_oauth_user,
    create_user,
    get_user_by_email,
)
from app.services.cache import CacheStore, get_cache_store
from app.services.events import record_event
from app.services.google_identity import GoogleIdentityError, verify_google_credential
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


@router.post("/google", response_model=TokenResponse)
async def google_login(
    payload: GoogleCredentialRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
    _: None = Depends(enforce_auth_rate_limit),
) -> TokenResponse:
    try:
        claims = await verify_google_credential(payload.credential)
    except GoogleIdentityError as exc:
        code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if "not configured" in str(exc)
            else status.HTTP_401_UNAUTHORIZED
        )
        raise HTTPException(code, str(exc)) from exc
    subject = str(claims["sub"])
    email = str(claims["email"]).lower()
    identity = await db.scalar(
        select(IdentityAccount).where(
            IdentityAccount.provider == "google",
            IdentityAccount.provider_subject == subject,
        )
    )
    if identity is not None:
        user = await db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is inactive")
    else:
        existing = await get_user_by_email(db, email)
        if existing is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Account exists; sign in with your password and link Google in settings",
            )
        user = await create_oauth_user(
            db,
            email=email,
            full_name=str(claims.get("name") or "") or None,
        )
        identity = IdentityAccount(
            user_id=user.id,
            provider="google",
            provider_subject=subject,
            email=email,
            profile={
                key: claims[key]
                for key in ("name", "picture", "given_name", "family_name")
                if key in claims
            },
        )
        db.add(identity)
    record_event(
        db,
        action="auth.google_signed_in",
        resource_type="user",
        resource_id=str(user.id),
        workspace_id=None,
        actor_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    await db.commit()
    return TokenResponse(access_token=await create_session(cache, user.id))


@router.get("/identities", response_model=list[IdentityOut])
async def list_identities(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[IdentityAccount]:
    result = await db.execute(
        select(IdentityAccount)
        .where(IdentityAccount.user_id == current_user.id)
        .order_by(IdentityAccount.created_at)
    )
    return list(result.scalars())


@router.post("/google/link", response_model=IdentityOut)
async def link_google(
    payload: GoogleCredentialRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IdentityAccount:
    try:
        claims = await verify_google_credential(payload.credential)
    except GoogleIdentityError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    subject = str(claims["sub"])
    existing = await db.scalar(
        select(IdentityAccount).where(
            IdentityAccount.provider == "google",
            IdentityAccount.provider_subject == subject,
        )
    )
    if existing is not None and existing.user_id != current_user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Google account is already linked")
    current = await db.scalar(
        select(IdentityAccount).where(
            IdentityAccount.user_id == current_user.id,
            IdentityAccount.provider == "google",
        )
    )
    if current is not None:
        return current
    identity = IdentityAccount(
        user_id=current_user.id,
        provider="google",
        provider_subject=subject,
        email=str(claims["email"]).lower(),
        profile={"name": claims.get("name"), "picture": claims.get("picture")},
    )
    db.add(identity)
    record_event(
        db,
        action="auth.identity_linked",
        resource_type="user",
        resource_id=str(current_user.id),
        workspace_id=None,
        actor_id=current_user.id,
        data={"provider": "google"},
    )
    await db.commit()
    await db.refresh(identity)
    return identity


@router.delete("/identities/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_identity(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    identity = await db.scalar(
        select(IdentityAccount).where(
            IdentityAccount.user_id == current_user.id,
            IdentityAccount.provider == provider,
        )
    )
    if identity is None:
        return
    identity_count = int(
        await db.scalar(
            select(func.count())
            .select_from(IdentityAccount)
            .where(IdentityAccount.user_id == current_user.id)
        )
        or 0
    )
    if current_user.hashed_password is None and identity_count <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Set a password before unlinking your only sign-in method",
        )
    await db.delete(identity)
    await db.commit()
