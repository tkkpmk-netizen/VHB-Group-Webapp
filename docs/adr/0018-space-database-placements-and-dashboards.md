# ADR 0018 — Space Database placements and Space-owned Dashboards

- Status: Accepted
- Date: 2026-07-17

## Context

The original resource tree stored `Database.folder_id`. That made one Folder
the exclusive owner of a Database, which conflicts with the product model: the
same business Database must be reusable by Sales, Operations, Marketing, or
other Spaces without copying its schema or Entities.

Dashboard was also exposed as a workspace-level mini app. The intended Space
experience instead needs a deterministic landing page, with each Space opening
its own default Dashboard. Folder selection in the Context Sidebar is only for
revealing or hiding nested Database links and must not replace that Dashboard.

## Decision

`Database` is an independent workspace-scoped inventory resource. It no longer
has `folder_id`. `Database.order` remains the stable ordering used by All
Database.

`SpaceDatabasePlacement` is the many-to-many boundary between `Space` and
`Database`:

- `(space_id, database_id)` is unique: a Database appears at most once in one
  Space, but can appear in any number of different Spaces.
- `folder_id` is optional and must reference a Folder in the same Space.
- `layout_id` is optional and must reference a Layout owned by the placed
  Database.
- `order` controls its position within the Space/Folder.
- `settings` is JSONB for Space-specific display configuration. It does not
  change the Database's global schema or Layout definitions.

Dashboard belongs to exactly one Space through non-null `Dashboard.space_id`.
One partial unique index guarantees at most one `is_default=true` Dashboard per
Space, and service/API rules guarantee at least one:

- creating a Space creates its `Overview` Dashboard in the same transaction;
- new personal workspaces create `General` plus `Overview`;
- deleting the only Dashboard in a Space is rejected;
- promoting another Dashboard atomically clears the previous default;
- a Dashboard widget can bind only a Database that has a placement in that
  Dashboard's Space.

## API and interaction contract

- `GET/POST /spaces/{space_id}/databases` lists or creates placements.
- `PATCH/DELETE /space-databases/{placement_id}` updates or removes one
  placement without deleting the Database.
- `POST /spaces/{space_id}/databases/reorder` moves/reorders placements within
  the Space.
- `GET /spaces/{space_id}/dashboard` returns the default Dashboard.
- `/databases?view=all` is the canonical Database inventory.
- `/databases?view=management` is the file-like Space/Folder management surface
  with a Database bar for drag-and-drop placement.
- `/databases?space={id}` renders the Space's default Dashboard.
- Folder controls in the Context Sidebar only expand/collapse their descendants;
  they do not navigate or change the work area.

Drag-and-drop has menu/dialog equivalents (`Add to Space`, `Move in Space`, and
`Remove from Space`) so touch and keyboard users are not blocked.

## Migration

Revision `b3e5f7a9c1d3`:

1. Creates `space_database_placements` and backfills every legacy non-null
   `Database.folder_id` using the owning Folder's `space_id` and existing order.
2. Drops `Database.folder_id` after the placement backfill.
3. Adds `Dashboard.space_id` and `Dashboard.is_default`.
4. Assigns existing Dashboards to the first ordered Space in their workspace,
   marks the latest one default, and creates `Overview` for every Space without
   a Dashboard.
5. Locks `Dashboard.space_id` to non-null and adds the partial unique default
   index.

## Consequences

- A Database can support multiple team contexts without duplicated data.
- Removing a Space, Folder, or placement never deletes the Database inventory.
- Each Space can remember a different default Layout/display configuration for
  the same Database.
- Space navigation is predictable: Space changes the work area to Dashboard;
  Folder changes only tree disclosure state.
- Placement writes require workspace write access, database read access, and
  full workspace/folder/layout scoping validation.

## Alternatives considered

- **Keep `Database.folder_id` and add shortcuts in other Spaces:** rejected;
  shortcuts would create a second, weaker resource type and ambiguous settings.
- **Allow multiple placements for the same Database inside one Space:** rejected
  for now; per-Space settings become ambiguous. A single placement can still
  expose any number of persisted Layouts.
- **Keep Dashboard as a global mini app and pin one to a Space:** rejected;
  Space ownership provides a clear lifecycle and default landing contract.
