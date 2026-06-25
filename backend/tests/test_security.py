"""Unit tests for security utils (no DB)."""

import time

import jwt
import pytest

from app.core import security
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    hashed = hash_password("s3cret-pass")
    assert hashed != "s3cret-pass"
    assert verify_password("s3cret-pass", hashed) is True
    assert verify_password("wrong", hashed) is False


def test_jwt_roundtrip() -> None:
    token = create_access_token("user-123")
    payload = decode_access_token(token)
    assert payload["sub"] == "user-123"


def test_jwt_invalid_signature_rejected() -> None:
    token = create_access_token("user-123")
    tampered = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(tampered)


def test_jwt_expired_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        security.settings, "access_token_expire_minutes", -1, raising=False
    )
    token = create_access_token("user-123")
    time.sleep(0.01)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_access_token(token)
