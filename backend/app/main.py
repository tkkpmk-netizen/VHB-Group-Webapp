"""FastAPI application entrypoint."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import __version__
from app.api.auth import router as auth_router
from app.api.databases import router as databases_router
from app.api.engine import router as engine_router
from app.api.workspaces import router as workspaces_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title=settings.app_name, version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(workspaces_router)
app.include_router(databases_router)
app.include_router(engine_router)


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    """Liveness probe — confirms the API is up."""
    return HealthResponse(status="ok", service=settings.app_name, version=__version__)
