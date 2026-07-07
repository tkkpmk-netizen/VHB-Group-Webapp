"""DP7 realtime collaboration hub tests."""

import pytest

from app.services.collaboration import CollaborationHub, Collaborator


class FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.messages: list[dict[str, object]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict[str, object]) -> None:
        self.messages.append(payload)


@pytest.mark.asyncio
async def test_collaboration_hub_presence_and_broadcast() -> None:
    hub = CollaborationHub()
    alice_socket = FakeWebSocket()
    bob_socket = FakeWebSocket()
    alice = Collaborator(
        session_id="alice-session",
        user_id="alice",
        name="Alice",
        email="alice@example.com",
    )
    bob = Collaborator(
        session_id="bob-session",
        user_id="bob",
        name="Bob",
        email="bob@example.com",
    )

    first_snapshot = await hub.join("document:workspace:doc", alice_socket, alice)  # type: ignore[arg-type]
    second_snapshot = await hub.join("document:workspace:doc", bob_socket, bob)  # type: ignore[arg-type]

    assert alice_socket.accepted is True
    assert bob_socket.accepted is True
    assert [user["user_id"] for user in first_snapshot] == ["alice"]
    assert {user["user_id"] for user in second_snapshot} == {"alice", "bob"}
    assert alice_socket.messages[-1]["type"] == "presence.joined"

    await hub.broadcast(
        "document:workspace:doc",
        {"type": "cursor.update", "data": {"blockId": "intro"}},
        exclude_session_id="alice-session",
    )
    assert bob_socket.messages[-1] == {
        "type": "cursor.update",
        "data": {"blockId": "intro"},
    }
    assert alice_socket.messages[-1]["type"] == "presence.joined"

    await hub.leave("document:workspace:doc", "bob-session")
    assert alice_socket.messages[-1]["type"] == "presence.left"
    assert await hub.room_size("document:workspace:doc") == 1
