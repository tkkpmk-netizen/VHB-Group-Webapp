"""Realtime collaboration websocket APIs for documents and site design."""

import uuid
from typing import Any

import jwt
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.document import Document
from app.models.permission import ResourceType
from app.models.site import Site, SitePage
from app.models.user import User
from app.models.workspace import Workspace
from app.services.authorization import Action, require_resource_action
from app.services.cache import get_cache_store
from app.services.collaboration import Collaborator, collaboration_hub

router = APIRouter(tags=["collaboration"])

ALLOWED_EVENT_TYPES = {
    "cursor.update",
    "selection.update",
    "content.changed",
    "design.changed",
    "ping",
}


async def _authenticate_socket(token: str, db: AsyncSession) -> tuple[User, str]:
    try:
        payload = decode_access_token(token)
        raw_user_id = payload.get("sub")
        session_id = payload.get("jti")
        if raw_user_id is None or session_id is None:
            raise ValueError("Invalid token payload")
        user_id = uuid.UUID(str(raw_user_id))
    except (jwt.PyJWTError, ValueError) as exc:
        raise ValueError("Could not validate credentials") from exc

    cache = get_cache_store()
    session_user_id = await cache.get(f"session:{session_id}")
    if session_user_id != str(user_id):
        raise ValueError("Session is not active")
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise ValueError("User not found")
    return user, str(session_id)


async def _authorize_room(
    *,
    db: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    resource_type: str,
    resource_id: uuid.UUID,
) -> str:
    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise ValueError("Workspace not found")
    if resource_type == "document":
        document = await db.get(Document, resource_id)
        if document is None or document.workspace_id != workspace_id:
            raise ValueError("Document not found")
        await require_resource_action(
            db,
            resource_type=ResourceType.document,
            resource_id=document.id,
            workspace_id=workspace_id,
            user_id=user_id,
            action=Action.read,
        )
        return f"document:{workspace_id}:{document.id}"
    if resource_type == "site_page":
        page = await db.get(SitePage, resource_id)
        if page is None:
            raise ValueError("Site page not found")
        site = await db.get(Site, page.site_id)
        if site is None or site.workspace_id != workspace_id:
            raise ValueError("Site page not found")
        await require_resource_action(
            db,
            resource_type=ResourceType.site,
            resource_id=site.id,
            workspace_id=workspace_id,
            user_id=user_id,
            action=Action.read,
        )
        return f"site_page:{workspace_id}:{page.id}"
    raise ValueError("Unsupported collaboration resource")


@router.websocket("/collaboration/ws/{resource_type}/{resource_id}")
async def collaboration_socket(
    websocket: WebSocket,
    resource_type: str,
    resource_id: uuid.UUID,
) -> None:
    token = websocket.query_params.get("token")
    raw_workspace_id = websocket.query_params.get("workspace_id")
    if not token or not raw_workspace_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with SessionLocal() as db:
        try:
            workspace_id = uuid.UUID(raw_workspace_id)
            user, session_id = await _authenticate_socket(token, db)
            room = await _authorize_room(
                db=db,
                workspace_id=workspace_id,
                user_id=user.id,
                resource_type=resource_type,
                resource_id=resource_id,
            )
        except (HTTPException, ValueError):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    collaborator = Collaborator(
        session_id=session_id,
        user_id=str(user.id),
        name=user.full_name or user.email,
        email=user.email,
    )
    await collaboration_hub.join(room, websocket, collaborator)
    try:
        while True:
            message = await websocket.receive_json()
            event_type = str(message.get("type") or "")
            if event_type not in ALLOWED_EVENT_TYPES:
                continue
            payload: dict[str, Any] = {
                "type": event_type,
                "resource_type": resource_type,
                "resource_id": str(resource_id),
                "user": collaborator.payload(),
                "data": message.get("data") if isinstance(message.get("data"), dict) else {},
            }
            if event_type == "ping":
                await websocket.send_json({"type": "pong"})
            else:
                await collaboration_hub.broadcast(
                    room,
                    payload,
                    exclude_session_id=collaborator.session_id,
                )
    except WebSocketDisconnect:
        await collaboration_hub.leave(room, collaborator.session_id)
