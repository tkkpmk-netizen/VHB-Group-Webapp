"""In-process realtime collaboration room hub.

DP7 establishes the websocket contract for presence and ephemeral collaboration
events. The hub is intentionally replaceable: production can swap the backing
fanout to Redis pub/sub without changing API payloads or frontend hooks.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


@dataclass(frozen=True)
class Collaborator:
    session_id: str
    user_id: str
    name: str
    email: str

    def payload(self) -> dict[str, str]:
        return {
            "session_id": self.session_id,
            "user_id": self.user_id,
            "name": self.name,
            "email": self.email,
        }


@dataclass
class RoomConnection:
    websocket: WebSocket
    collaborator: Collaborator


class CollaborationHub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, RoomConnection]] = {}
        self._lock = asyncio.Lock()

    async def join(
        self,
        room: str,
        websocket: WebSocket,
        collaborator: Collaborator,
    ) -> list[dict[str, str]]:
        await websocket.accept()
        async with self._lock:
            connections = self._rooms.setdefault(room, {})
            connections[collaborator.session_id] = RoomConnection(websocket, collaborator)
            snapshot = [connection.collaborator.payload() for connection in connections.values()]
        await websocket.send_json({"type": "presence.snapshot", "users": snapshot})
        await self.broadcast(
            room,
            {
                "type": "presence.joined",
                "user": collaborator.payload(),
            },
            exclude_session_id=collaborator.session_id,
        )
        return snapshot

    async def leave(self, room: str, session_id: str) -> None:
        async with self._lock:
            connections = self._rooms.get(room)
            if not connections:
                return
            connection = connections.pop(session_id, None)
            if not connections:
                self._rooms.pop(room, None)
        if connection is not None:
            await self.broadcast(
                room,
                {
                    "type": "presence.left",
                    "user": connection.collaborator.payload(),
                },
            )

    async def broadcast(
        self,
        room: str,
        payload: dict[str, Any],
        *,
        exclude_session_id: str | None = None,
    ) -> None:
        async with self._lock:
            targets = [
                connection
                for session_id, connection in self._rooms.get(room, {}).items()
                if session_id != exclude_session_id
            ]
        for connection in targets:
            try:
                await connection.websocket.send_json(payload)
            except RuntimeError:
                # The receive loop will clean up disconnected sockets.
                continue

    async def room_size(self, room: str) -> int:
        async with self._lock:
            return len(self._rooms.get(room, {}))


collaboration_hub = CollaborationHub()
