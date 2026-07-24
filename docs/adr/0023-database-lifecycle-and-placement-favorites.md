# ADR 0023: Database lifecycle and placement-scoped favorites

## Status

Accepted — 2026-07-23

## Decision

- A canonical Database can be duplicated or permanently deleted from All
  Database. Duplication creates a new empty Database with copied fields,
  primary DataSource and canonical Layouts; entities, grants and Space
  placements are deliberately not copied.
- Database access is managed through the existing resource-grant panel from
  All Database. Delete requires database manage permission.
- Favorites represent a Space Database placement (the Space-specific view), not
  the canonical Database. A favorite opens with its `placement` id and retains
  that Space's independent Layout configuration.
- Pinned Space Layout tabs show the layout label only. The underlying database
  is available in the hover label, avoiding duplicate visual hierarchy.
- Native browser context menus are suppressed inside the authenticated app; the
  shared app menu is the fallback while resource rows expose item-specific
  management menus.

## Consequences

Deleting a canonical Database cascades to its resources and every placement;
removing a placement only removes that Space view. The context tree remains a
compact, rounded ClickUp-style control surface while All Database keeps its
more descriptive inventory rows.
