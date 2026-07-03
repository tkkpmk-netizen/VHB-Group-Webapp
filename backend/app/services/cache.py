"""Redis-backed cache/session/rate-limit abstraction."""

from functools import lru_cache
from typing import Protocol

from redis.asyncio import Redis

from app.core.config import get_settings


class CacheStore(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl_seconds: int) -> None: ...
    async def delete(self, key: str) -> None: ...
    async def increment(self, key: str, ttl_seconds: int) -> int: ...
    async def ping(self) -> bool: ...


class RedisCacheStore:
    def __init__(self) -> None:
        self.redis = Redis.from_url(get_settings().redis_url, decode_responses=True)

    async def get(self, key: str) -> str | None:
        value = await self.redis.get(key)
        return str(value) if value is not None else None

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        await self.redis.set(key, value, ex=ttl_seconds)

    async def delete(self, key: str) -> None:
        await self.redis.delete(key)

    async def increment(self, key: str, ttl_seconds: int) -> int:
        async with self.redis.pipeline(transaction=True) as pipeline:
            pipeline.incr(key)
            pipeline.expire(key, ttl_seconds)
            result = await pipeline.execute()
        return int(result[0])

    async def ping(self) -> bool:
        return bool(await self.redis.ping())


@lru_cache
def get_cache_store() -> CacheStore:
    return RedisCacheStore()
