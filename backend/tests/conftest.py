"""Shared test fixtures (DB-backed integration tests).

Tests run against a SEPARATE database (vhb_test) so they never touch dev data.
Override with TEST_DATABASE_URL if needed.
"""

import os
from collections.abc import AsyncGenerator

import httpx
import pytest_asyncio
from httpx import ASGITransport
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

import app.models  # noqa: F401  (register all tables on Base.metadata)
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services.cache import get_cache_store


class FakeCache:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.counts: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, ttl_seconds: int) -> None:
        self.values[key] = value

    async def delete(self, key: str) -> None:
        self.values.pop(key, None)

    async def increment(self, key: str, ttl_seconds: int) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def ping(self) -> bool:
        return True


def _test_database_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit
    # Derive a sibling "<db>_test" database from the configured DATABASE_URL.
    base = get_settings().database_url
    db_name = base.rsplit("/", 1)[-1]
    return base.rsplit("/", 1)[0] + f"/{db_name}_test"


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient]:
    engine = create_async_engine(_test_database_url(), poolclass=NullPool)

    # Ensure a clean schema for every test.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    test_session = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db() -> AsyncGenerator[AsyncSession]:
        async with test_session() as session:
            yield session

    fake_cache = FakeCache()
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_cache_store] = lambda: fake_cache
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await engine.dispose()
