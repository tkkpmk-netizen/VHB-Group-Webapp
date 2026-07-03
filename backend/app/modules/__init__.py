"""Modular-monolith composition root.

Domain packages expose routers here; the FastAPI entrypoint knows only this
registry, keeping module ownership explicit while services remain in-process.
"""

from dataclasses import dataclass

from fastapi import APIRouter

from app.api.assets import router as assets_router
from app.api.audit import router as audit_router
from app.api.auth import router as auth_router
from app.api.databases import router as databases_router
from app.api.documents import router as documents_router
from app.api.engine import router as engine_router
from app.api.jobs import router as jobs_router
from app.api.resources import router as resources_router
from app.api.transfers import router as transfers_router
from app.api.views import router as views_router
from app.api.workspaces import router as workspaces_router


@dataclass(frozen=True)
class PlatformModule:
    name: str
    routers: tuple[APIRouter, ...]
    owns: tuple[str, ...]


MODULES = (
    PlatformModule("identity", (auth_router,), ("users", "sessions")),
    PlatformModule(
        "workspace",
        (workspaces_router, resources_router),
        ("workspaces", "spaces", "folders", "permissions"),
    ),
    PlatformModule(
        "database",
        (databases_router, engine_router, views_router),
        ("databases", "fields", "rows", "views"),
    ),
    PlatformModule("documents", (documents_router,), ("documents",)),
    PlatformModule(
        "transfers",
        (assets_router, jobs_router, transfers_router),
        ("assets", "jobs", "imports", "exports"),
    ),
    PlatformModule("governance", (audit_router,), ("audit_events", "outbox_events")),
)


def all_routers() -> tuple[APIRouter, ...]:
    return tuple(router for module in MODULES for router in module.routers)
