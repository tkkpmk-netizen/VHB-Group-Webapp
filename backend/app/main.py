"""FastAPI application entrypoint."""

import asyncio
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app import __version__
from app.core.config import get_settings
from app.db.session import get_db
from app.modules import all_routers
from app.services.cache import CacheStore, get_cache_store
from app.services.observability import (
    render_prometheus,
    request_count,
    request_duration_seconds,
)
from app.worker import main as worker_main

settings = get_settings()
logger = logging.getLogger("vhb.requests")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Run a worker beside the API in development; production uses a separate process."""
    worker_task: asyncio.Task[None] | None = None
    if settings.environment == "development":
        worker_task = asyncio.create_task(worker_main(), name="development-job-worker")
    try:
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await worker_task


app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def observe_requests(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request_failed",
            extra={"request_id": request_id, "method": request.method, "path": request.url.path},
        )
        raise
    duration = time.perf_counter() - started
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    request_count[(request.method, path, response.status_code)] += 1
    request_duration_seconds[(request.method, path)] += duration
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": path,
            "status": response.status_code,
            "duration_ms": round(duration * 1000, 2),
        },
    )
    return response


for router in all_routers():
    app.include_router(router)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Liveness probe — confirms the API is up."""
    return HealthResponse(status="ok", service=settings.app_name, version=__version__)


@app.get("/health/ready", tags=["system"])
async def readiness(
    db: AsyncSession = Depends(get_db),
    cache: CacheStore = Depends(get_cache_store),
) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    if not await cache.ping():
        return Response(status_code=status.HTTP_503_SERVICE_UNAVAILABLE)  # type: ignore[return-value]
    return {"status": "ready", "database": "ok", "redis": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    return Response(render_prometheus(), media_type="text/plain; version=0.0.4")
