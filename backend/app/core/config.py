"""Application settings, loaded from environment (.env)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_name: str = "VHB Super App API"
    environment: str = "development"

    # CORS — frontend origin(s), comma-separated
    cors_origins: str = "http://localhost:3000"

    # Database (Postgres via Docker). asyncpg driver for SQLAlchemy async.
    database_url: str = (
        "postgresql+asyncpg://vhb:vhb@localhost:5432/vhb"
    )

    # Auth — FastAPI issues + verifies its own JWTs (HS256).
    # Dev default is ≥32 bytes; MUST be overridden in production via env.
    jwt_secret: str = "dev-insecure-change-me-please-override-32b"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
