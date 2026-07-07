# ADR 0016: Realtime Collaboration Contract for Docs and Design

Status: Accepted  
Date: 2026-07-07

## Context

DP7 needs collaboration for Documents and Web Designer without destabilizing the
existing autosave/versioning and build/deployment pipelines. A full CRDT merge
engine can be added later, but users need immediate awareness of who is editing
and lightweight realtime events.

## Decision

Introduce a WebSocket collaboration contract:

- Endpoint: `/collaboration/ws/{resource_type}/{resource_id}`.
- Supported resources in the MVP: `document` and `site_page`.
- Clients authenticate with the existing JWT token and active session.
- Clients must provide `workspace_id`; the server checks resource access before
  joining the room.
- Server sends `presence.snapshot`, `presence.joined`, and `presence.left`.
- Clients may broadcast `cursor.update`, `selection.update`, `content.changed`,
  and `design.changed`.
- Document and design persistence remains through existing HTTP autosave/save
  endpoints; realtime events are awareness/coordination signals, not the source
  of truth.

## Rationale

This gives the product a stable collaboration surface now while avoiding the
data-loss risks of partial CRDT integration. The source-of-truth rules remain
clear:

- Block documents persist through optimistic versioned content saves.
- Site page designs persist through explicit Web Designer saves.
- Collaboration events are ephemeral and can be dropped without corrupting data.

The initial hub is in-process so local development and tests remain simple. The
event payloads and room naming are designed so Redis pub/sub or a dedicated
realtime service can replace the fanout implementation later.

## Consequences

- Multi-process production deployments need Redis pub/sub fanout before relying
  on cross-instance presence accuracy.
- Future CRDT support should reuse the same auth/room boundary.
- Presence and events can power UI affordances such as avatars, edit activity,
  cursors, and save conflict warnings without changing persistence APIs.
