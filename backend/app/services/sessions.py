"""Redis session registry."""

import uuid

from app.core.config import get_settings
from app.core.security import create_access_token
from app.services.cache import CacheStore


async def create_session(cache: CacheStore, user_id: uuid.UUID) -> str:
    settings = get_settings()
    session_id = str(uuid.uuid4())
    ttl = settings.access_token_expire_minutes * 60
    await cache.set(f"session:{session_id}", str(user_id), ttl)
    return create_access_token(str(user_id), session_id)


async def revoke_session(cache: CacheStore, session_id: str) -> None:
    await cache.delete(f"session:{session_id}")
