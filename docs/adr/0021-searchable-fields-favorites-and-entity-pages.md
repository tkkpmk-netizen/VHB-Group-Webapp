# ADR 0021: Searchable fields, Favorites, icon colors, and Entity pages

- Status: Accepted
- Date: 2026-07-23

## Context

The Database UI already supports Space-specific placements, independently
cloned Layouts, Entity popup editing, Entity-created Documents and a shared
Font Awesome 5 Solid icon picker. Runtime comparison with ClickUp and Notion
showed several remaining inconsistencies:

- high-cardinality Relation and Country choices, plus user-defined Select
  choices, were difficult to scan without search;
- the built-in Entity identifier displayed a generated prefix even when the
  user had not configured one;
- dragging visually detached the source item from its toolbar/tree;
- database utilities and Customize could compete with the Layout bar;
- Space dashboards, Entity Documents, Favorites and icon color were not
  expressed consistently in the product model.

## Decision

### Searchable field choices

Relation, Country, Select and Multi-select use the shared searchable Dropdown.
Options may supply extra normalized search text so a Relation can match its
business identifier and a Country can match name, code and dialing metadata.
Country choices are generated from the maintained `world-countries` catalog
instead of a hand-maintained subset.

### Business-facing Entity ID

The internal Entity UUID remains the stable database/API identity. The built-in
ID field is a business-facing value derived from `Entity.seq`: by default it is
`1`, `2`, and so on. A non-empty field prefix is prepended when configured.
New, bulk-created and imported Entities persist the plain sequence string; the
migration rewrites existing built-in ID cell values to the same representation.

### Personal Favorites

`DatabaseFavorite` is a workspace-scoped, per-user join between User and
Database. Favorite/unfavorite endpoints are idempotent. Database list responses
include request-scoped `is_favorite`; Favorites render above Spaces in the
Context Sidebar as canonical Database links. A Favorite never creates, moves or
deletes a Space placement.

### Icon color

Database, Folder, Field, Layout and Document persist `icon_color`; Space keeps
using its existing `color`. The shared IconPicker owns both icon and semantic
color selection, so every resource editor uses the same accessible palette.

### Layout bar, panels, and dragging

Layout tabs start on the left; Search, Automation, Share and Import/Export are a
right-aligned fixed utility cluster. Search is a fixed-width, right-anchored
popover. Customize is positioned relative to the database view shell and begins
below the Layout bar. It cannot cover the database header or tabs.

During drag, the source stays at its original position and is highlighted. The
native ghost is transparent. Reorder/move state follows pointer entry in real
time; pointer release only terminates the drag session. Required menu/dialog
alternatives remain available.

### Space Overview and Entity-created Documents

Every Space owns an editable default Dashboard named `Overview`; selecting a
Space opens it directly. Folder interaction remains disclosure-only.

The Entity action is attached to the top-right of the Name cell. Entity-created
Documents render the source Entity as a Notion-style property page: title,
optional icon/color, individually hideable editable metadata, then the BlockNote
body. The generated document body starts blank so metadata is not duplicated.

## Database changes

Revision `e6b8d0f2a4c6`:

- adds `icon_color` to databases, folders, fields, layouts and documents;
- creates `database_favorites` with workspace/user/database foreign keys and a
  unique constraint;
- converts existing built-in Entity ID values to their plain sequence string.

## Consequences

- The country package is now part of the frontend dependency graph and should
  be updated through normal dependency maintenance.
- Prefix display is a frontend formatting concern backed by the persisted field
  configuration; callers must use the shared Entity ID formatter.
- Favorites are user preferences and must be joined/scoped using the current
  authenticated user, never inferred from a shared Database row.
- Entity metadata edits in a Document update the source Entity and therefore
  appear immediately in every Layout that reads that Entity.

## Verification

- Backend: 86 tests collected; Database favorite integration and sequential ID
  assertions pass, together with ruff and mypy.
- Frontend: 20 tests, TypeScript typecheck, ESLint and Next production build
  pass.
- Runtime QA verifies the right-aligned utilities, bounded Customize panel,
  Favorite pinning, icon color palette and persistent highlighted drag source.
