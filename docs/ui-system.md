# VHB Product UI System

## Direction

The product UI follows ClickUp 4.0 interaction and density patterns while keeping
VHB branding. English is the default product language. Vietnamese is the planned
secondary language.

The first approved reference surface is the Database module. The shell and tokens
defined here are shared by all modules.

## Layout tokens

| Token | Value | Purpose |
|---|---:|---|
| `--app-rail-width` | `52px` | Persistent Global Navigation on desktop |
| `--app-topbar-height` | `40px` | Global search and account/workspace actions |
| `--context-sidebar-width` | `256px` | Module-specific hierarchy and navigation |
| `--radius` | `6px` | Default control and container radius |

On viewports below `1024px`, Global Navigation is replaced by the module grid in
the Context Sidebar drawer. The main content remains usable without horizontal
page overflow. Dense data views may retain their own horizontal scroll region.

## Color tokens

| Role | Token | Light value |
|---|---|---|
| Global Navigation start | `--app-rail-start` | `#0d63bd` |
| Global Navigation end | `--app-rail-end` | `#084d9f` |
| Primary action | `--primary` | `#0c8ce9` |
| Canvas | `--surface-canvas` | `#f9f9f9` |
| Context surface | `--surface-subtle` | `#f9f9f9` |
| Hover surface | `--surface-hover` | `#eef0f2` |
| Selected surface | `--surface-selected` | `#e9f3ff` |
| Primary text | `--text-primary` | `#202020` |
| Secondary text | `--text-secondary` | `#646464` |
| Border | `--border` | `#e8eaed` |

Status colors are semantic and may use additional colors. Decorative color is
not added to navigation or neutral controls.

## Standard icon system

- Font Awesome Free 5.15.3 **Solid** is the only general-purpose interface icon
  family. The source archive is vendored under
  `frontend/public/icons/fa5-solid/`; its original attribution is retained and
  `LICENSE.md` records the CC BY 4.0/MIT/OFL terms.
- UI code renders icons through `FaIcon`. The previous Lucide dependency has
  been removed, and hand-authored SVG paths or emoji must not be used as
  interface controls. Country flags remain data content, not action icons.
- Space, Folder, Database, Layout, Field and Document store an icon name. Their
  create/edit surfaces use the shared searchable `IconPicker`, which exposes
  all 1,002 Solid glyphs and a short recommended set first.
- The same picker includes a ClickUp-derived semantic palette. Icon color is a
  persisted property of Database, Folder, Field, Layout and Document; Space
  continues to use its existing color property. Color never replaces icon
  shape or text as the only carrier of meaning.
- Icon shape carries meaning; color only accelerates recognition. ClickUp-like
  semantic tokens are used consistently: Space purple, Folder magenta,
  Database blue, Calendar orange, relation teal and computed fields magenta.
- Icon-only buttons require an accessible name and visible focus ring. Required
  actions cannot depend only on hover; hover-hidden actions are also visible on
  keyboard focus and touch devices.

## Typography and density

- Geist is the shared sans-serif family.
- Product body text defaults to `13px` with `1.4` line height.
- Shell labels use `9px` to `12px` depending on available width.
- Default controls are `28px` to `32px` high.
- Database rows target the compact ClickUp density and use separators instead
  of card containers.

## Branding

- The VHB mark is white and monochrome inside Global Navigation.
- The gold gradient mark and horizontal logo are reserved for Login and larger
  brand surfaces.
- ClickUp names, marks and logos are not used in the product.

## Navigation states

| State | Global Navigation | Context Sidebar |
|---|---|---|
| Default | White icon at reduced opacity | Secondary text on subtle surface |
| Hover | Translucent white surface | Neutral hover surface |
| Active | White icon tile with blue icon | Blue selected surface and text |
| Focus | Two-pixel semantic focus ring | Two-pixel semantic focus ring |
| Disabled | Reduced opacity, no pointer action | Reduced opacity with explanatory title |

## Space and database hierarchy

- `/databases` and `/databases?view=management` open Space Management. The work
  area is a dense FTP-style tree table (`Name`, `Type`, `Location`) ordered as
  Space → nested Folder → Database, with the Database bar fixed on the right.
- `/databases?view=all` is the complete database inventory. Spaces and folders
  create configurable placements of those databases but never replace this
  inventory. One Database can have one placement in each of many Spaces.
- Each placement stores its own Folder, order, Layout collection and display
  settings. Canonical Layouts are copied only when a placement is first added;
  later Layout CRUD/configuration is isolated to that placement. Moving a
  placement does not move or duplicate the Database itself.
- `All Database` stays at the bottom of the Context Sidebar. `Space Management`
  is directly below it. Dropping a placement on `All Database` removes only that
  Space placement.
- User Favorites appear as a compact section above Spaces. Favoriting a
  Database pins a canonical Database link for that user without creating or
  moving a Space placement.
- Clicking a Space opens `/databases?space={id}` and renders that Space's
  default Dashboard in the work area. Dashboards are owned by Spaces and are
  not a Global Navigation mini app.
- Every Space owns an editable default Dashboard named `Overview`. Its header,
  view tab, widget grid and Customize/Add card actions use the same dense
  ClickUp-style visual hierarchy as the Database module.
- A Folder label in the Context Sidebar is a disclosure button only. Clicking
  it expands or collapses nested Folders and Databases without changing the
  current work area or URL.
- Space and Folder rows reveal create and management actions on hover or
  keyboard focus. Primary labels remain uncluttered at rest.
- Database placements can be dragged between folders and reordered inside a
  Space. Valid targets apply the move as the pointer enters them; release only
  ends the session. The original row stays in place and receives a selected
  source treatment; no detached native/floating ghost replaces it. Dragging
  from the Database bar creates a placement while preserving placements in
  other Spaces.
- `Add to Space`, `Move in Space`, and `Remove from Space` actions provide
  equivalent flows for touch and keyboard users; hover is never the only way
  to perform a required action.
- Create, rename, move and delete forms use floating dialogs and shared custom
  dropdowns. They never push the resource tree or data content.
- A Database header renders every valid placement address as
  `Space / Folder / … / Database`. If it has no Space placement, the fallback
  address is `All Database / Database`. No arbitrary “primary” address is
  invented for a Database that lives in multiple Spaces.

## Database Layout bar

- Layout tabs begin at the left. The fixed utility cluster at the far right is
  ordered Search, Automation, Share, then Import/Export.
- Opening Search creates a 320px right-anchored floating popover below its icon. It never adds
  width to the Layout bar, compresses tabs, or changes the work area's geometry.
- Layout tabs store their own icon; double-click opens the compact name/icon
  and color editor. Dragging a tab changes its persisted order while leaving the
  source tab visible and highlighted.
- The Customize panel is absolutely bounded below this bar and above the work
  area bottom; it never covers header or navigation bars.

## Choice menus and entity identifiers

- Relation, Country, Select and Multi-select use the shared searchable popover.
  Country data is sourced from the full maintained country/territory catalog.
- The built-in ID/UUID field displays the Entity sequence as a plain number
  (`1`, `2`, …) by default. A configured prefix is prepended exactly once; the
  internal UUID remains the API/database identity and is not exposed as the
  default business identifier.

## Entity and Document windows

- Every Database Layout exposes an `Open entity` action (Calendar/Timeline use
  double-click on the event/entity label). It opens an in-app modal over the
  current Layout without route loss.
- The Entity window edits the canonical name and all editable cells through the
  same `CellEditor` components used by Table/List/Board/Gallery.
- Table rows place `Open entity` in the top-right of the Name cell rather than a
  trailing action column. This keeps the record action attached to its title.
- `Create Doc` creates a workspace-scoped Document with `source_entity_id` and
  opens BlockNote in a second, larger popup window. Closing the Document returns
  to the Entity; closing the Entity returns to the unchanged Layout.
- Entity-created Documents render as Notion-style pages: a large editable title,
  optional icon/color, an editable metadata property section with show/hide
  controls, and the BlockNote body below it. Metadata is rendered from the
  source Entity and is not duplicated as generated document body text.

## Workspace selector

- The workspace selector is an initials avatar on the right of the global
  topbar, immediately before Log out. The context-sidebar-aligned topbar area no
  longer contains a workspace control.
- Activating the avatar opens a right-aligned custom menu with user identity,
  workspace names and roles. Selecting an item updates the explicit workspace
  header, clears workspace-scoped query data and returns to Home.

## Overlay rules

- Menus, popovers and side panels overlay content and never push a data view.
- The shared layer scale is menu backdrop `80`, menu `90`, dialog `100`,
  dropdown backdrop/content `130/140`, icon picker `160`, drag preview `200`.
  The icon picker therefore remains above any dialog or menu that launches it.
- Popovers use `--shadow-popover`, an `8px` radius and a one-pixel border.
- Standard feedback uses `160ms`; structural transitions use `220ms` with
  `cubic-bezier(0.16, 1, 0.3, 1)`. Reduced-motion removes both.

## Accessibility

- Every icon-only action has an accessible name.
- Active navigation uses `aria-current="page"`.
- Menu triggers expose `aria-expanded` and `aria-haspopup`.
- Disabled reference controls explain why they are unavailable in their title.
- Focus remains visible for keyboard navigation.
- Text and interactive controls target WCAG AA contrast.

## Current delivery boundary

Light mode is the approval baseline. Dark mode is intentionally deferred until
the Database reference implementation is approved. Features shown in the ClickUp
reference but not supported by VHB must be visibly unavailable rather than
simulated.
