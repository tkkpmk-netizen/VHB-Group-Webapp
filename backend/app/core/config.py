"""Application settings, loaded from environment (.env)."""

from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_name: str = "VHB Super App API"
    environment: str = "development"

    # CORS — frontend origin(s), comma-separated
    cors_origins: str = "http://localhost:3000"

    # Database (Postgres via Docker). asyncpg driver for SQLAlchemy async.
    database_url: str = "postgresql+asyncpg://vhb:vhb@localhost:5432/vhb"

    # Auth — FastAPI issues + verifies its own JWTs (HS256).
    # Dev default is ≥32 bytes; MUST be overridden in production via env.
    jwt_secret: str = "dev-insecure-change-me-please-override-32b"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24

    # S3-compatible object storage. MinIO is the local implementation.
    storage_endpoint_url: str = "http://localhost:9000"
    storage_public_endpoint_url: str = "http://localhost:9000"
    storage_access_key: str = "vhb_minio"
    storage_secret_key: str = "vhb_minio_secret"
    storage_bucket: str = "vhb-assets"
    storage_region: str = "us-east-1"
    storage_presign_ttl_seconds: int = 900

    # PostgreSQL-backed durable worker settings.
    worker_poll_seconds: float = 1.0
    worker_lease_seconds: int = 300
    worker_max_attempts: int = 3

    # Redis-backed sessions, rate limits and short-lived cache values.
    redis_url: str = "redis://localhost:6379/0"
    auth_rate_limit_per_minute: int = 20

    # Google Identity Services.
    google_client_id: str | None = None

    # Email notifications. Empty host keeps email delivery disabled.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "notifications@vhb.local"
    smtp_use_tls: bool = True

    # CM7 Google Shared Drive storage.
    google_drive_service_account_file: str | None = None
    google_drive_folder_id: str | None = None
    google_drive_max_file_bytes: int = 100 * 1024 * 1024

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.environment == "production":
            if self.jwt_secret.startswith("dev-") or len(self.jwt_secret) < 32:
                raise ValueError("Production JWT_SECRET must be at least 32 secure characters")
            if self.storage_secret_key == "vhb_minio_secret":
                raise ValueError("Production storage credentials must be overridden")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
