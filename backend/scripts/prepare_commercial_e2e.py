"""Reset and migrate the dedicated full-stack test database.

The exact-name guard intentionally makes this script unusable against `vhb` or
any other database. Playwright owns `vhb_test` for the duration of its run.
"""

import asyncio
import os
from pathlib import Path

from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

from alembic import command

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://vhb:vhb@localhost:5432/vhb_test",
)


async def reset_schema() -> None:
    database_name = make_url(TEST_DATABASE_URL).database
    if database_name != "vhb_test":
        raise RuntimeError(
            f"Refusing to reset database {database_name!r}; expected exactly 'vhb_test'"
        )
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
    finally:
        await engine.dispose()


def migrate_to_head() -> None:
    os.environ["DATABASE_URL"] = TEST_DATABASE_URL
    backend_dir = Path(__file__).resolve().parents[1]
    alembic_config = Config(str(backend_dir / "alembic.ini"))
    command.upgrade(alembic_config, "head")


if __name__ == "__main__":
    asyncio.run(reset_schema())
    migrate_to_head()

