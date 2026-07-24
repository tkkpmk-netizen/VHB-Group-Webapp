# ADR 0019 — FA5 Solid icons and Entity-linked Documents

- Status: Accepted
- Date: 2026-07-17

## Context

The UI previously mixed Lucide components, emoji stored as resource icons and
text fallbacks. This made the same resource look different across the Context
Sidebar, Space Management and Database headers. Database Entities also had no
single detail surface: users had to edit through whichever Layout happened to
be open, and Documents created from business records lost their source context.

## Decision

Font Awesome Free 5.15.3 Solid is the platform interface icon family. The 1,002
original SVG files are served from `frontend/public/icons/fa5-solid`; each file
retains its Font Awesome attribution. `FaIcon` renders them as a CSS mask so one
SVG can use semantic `currentColor` tokens. `IconPicker` searches the generated
manifest and is shared by resource editors.

Icon names are persisted as nullable `VARCHAR(64)` values for Space, Folder,
Database, Layout, Field and Document. Null remains valid for compatibility; the
frontend supplies a semantic type fallback. Migration `c4f6a8b0d2e4` adds the
new columns, widens legacy icon columns and backfills meaningful Solid glyphs.

Entity detail is an overlay owned by the Database Layout shell. It reuses the
existing `CellEditor` implementation and PATCHes partial cell/name updates to
the workspace-scoped Entity API. Every Layout can open the same detail surface,
so editing semantics do not diverge by Layout.

Document gains nullable `source_entity_id` with `ON DELETE SET NULL`. Creating a
Document from an Entity verifies the Entity through its parent Database's
workspace before writing the link. The Document editor opens as a nested popup;
Document lifecycle and permissions remain independent after creation.

## Consequences

- Resource identity is consistent across the entire shell and survives reloads.
- Icon color is semantic but never the only state signal.
- Adding future resources requires a stored icon name plus a semantic fallback,
  not a new icon library.
- Entity editing and Entity-to-Document creation preserve the current Layout and
  browser route.
- Deleting an Entity does not delete authored Documents; it clears their source
  link.

## Alternatives considered

- **Continue storing emoji:** rejected because appearance differs by OS and is
  incompatible with a controlled enterprise icon language.
- **Bundle several icon libraries:** rejected because mixed stroke/fill geometry
  weakens recognition and increases client dependencies.
- **Navigate to a separate Entity page:** rejected for the current workflow;
  users need to inspect/edit a record without losing filtered Layout context.
- **Store Entity metadata only inside Document content:** rejected because it is
  not queryable or enforceable as a workspace-scoped relationship.
