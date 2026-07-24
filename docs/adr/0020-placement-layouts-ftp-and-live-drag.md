# ADR 0020 — Placement-specific Layouts, FTP explorer and live drag

- Status: Accepted
- Date: 2026-07-23

## Context

A Database is canonical workspace data but can be placed in many Spaces. The
previous `SpaceDatabasePlacement.layout_id` selected a canonical Layout, so
editing a view for Sales also changed the view seen by Operations. Space
Management also represented the hierarchy as large cards, which became hard to
scan once Spaces contained nested Folders and many Databases. Native HTML drag
ghosts delayed visible reordering until drop and obscured the destination.

## Decision

`Layout.placement_id` is an optional foreign key to
`SpaceDatabasePlacement`. A null value means the Layout belongs to the
canonical Database; a non-null value means it belongs only to that placement.
`Layout.source_layout_id` records which canonical Layout supplied the initial
copy.

Creating a placement clones the Database's canonical Layouts once, including
name, icon, type, config and order. After creation, placement Layouts are fully
independent: users can add, rename, reorder, configure and delete them without
changing canonical Layouts or another Space. View Presets remain nested under
their actual Layout and are not shared by reference.

The Layout API accepts optional `placement_id` on list/create. The placement is
validated through its Space and workspace and must point at the requested
Database. Canonical behavior remains the default when the query is absent.

Space Management is a dense FTP-style tree table with the columns Name, Type
and Location. Rows are ordered Space → nested Folder → Database placement. The
Database bar remains fixed on the right. Database links include
`?placement={placement_id}` so the correct breadcrumb and isolated Layout set
open.

During drag, the source row/tab remains in its original hierarchy or toolbar and
receives a selected/highlighted treatment while the native faded ghost is
suppressed. Reorder/move operations apply when the pointer enters a valid
destination; pointer release only ends the drag session. Layout and tree
reordering use moderate ease-out movement. Menus/pickers use ease-out on enter
and ease-in-compatible exit values, and respect `prefers-reduced-motion`.

## Migration

Revision `d5a7c9e1f3b5` adds the two Layout foreign keys and a unique
`(placement_id, source_layout_id)` constraint, clones existing canonical
Layouts for existing placements, and points each placement at its matching
clone (or its first clone when no previous default exists).

## Consequences

- Entities, Fields and DataSources remain canonical; only presentation is
  placement-specific.
- A newly added Database begins with familiar canonical views but can diverge
  safely in every Space.
- Space Management scales vertically and preserves a visible full location.
- Dragging communicates the live result before release and has menu/dialog
  alternatives for keyboard and touch users.
- Overlay layers are explicit: menu 90, dialog 100, dropdown 140 and icon picker
  160. Dragging does not introduce a detached preview layer.

## Alternatives considered

- **Store overrides in placement JSON:** rejected because view CRUD, presets,
  ordering and configuration need ordinary relational identity and APIs.
- **Share canonical Layout rows across placements:** rejected because it keeps
  the cross-Space mutation bug.
- **Keep card management:** rejected because cards hide depth and waste scan
  area in an operational file hierarchy.
