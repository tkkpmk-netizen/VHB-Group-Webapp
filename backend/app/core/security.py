"""Password hashing and JWT issuing/verification (app-owned auth)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings

settings = get_settings()
_password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _password_hash.verify(password, hashed)


def create_access_token(subject: str, session_id: str | None = None) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": subject,
        "jti": session_id or str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode & verify a JWT. Raises jwt.PyJWTError on invalid/expired tokens."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
