# UX Guidelines

These rules apply to every current and future module.

## Choice controls

- Never use native `<select>` or OS choice menus.
- Use the shared `Dropdown` and `MultiDropdown` components in
  `frontend/src/components/ui/dropdown.tsx`.
- Multi-select values appear as compact chips and are changed in a popover.
- Relation, Country, Select, and Multi-select menus always include in-popover
  search. Search matches labels and relevant secondary metadata without changing
  the width of the field or data view.
- Country choices come from the complete ISO-backed country/territory catalog;
  flags are data content rather than interface icons.
- Number inputs should not expose native steppers when a text/decimal interaction
  is more appropriate.

## Overlays and layout stability

- Menus, selection toolbars, and field forms float above content.
- Do not insert temporary panels that push a table, board, or document down.
- Portal overlays must remain inside the viewport, flip when space is limited,
  and appear above sticky headers/footers.
- A Database Customize panel starts immediately below the Layout bar and is
  bounded by the remaining work area. It must not cover the database header,
  breadcrumb, or Layout bar.
- Search, Automation, Share, and Import/Export form the right-aligned utility
  cluster of the Layout bar. Search opens a fixed-width overlay and never
  stretches or reflows the Layout tabs.

## Keyboard and mouse parity

- Every primary action must work with mouse and keyboard.
- `Enter` commits inline edits; `Escape` cancels or closes the active overlay.
- Dropdowns support arrow keys, Home/End, Enter, and Escape.
- Preserve focus when opening/closing popovers and expose accessible labels.
- Dragging keeps the original item in its list or toolbar and marks it as the
  active source. Targets update as the pointer enters them; releasing the
  pointer ends the interaction instead of acting as a separate confirmation.

## Data views

- Use compact ClickUp-style density and consistent toolbar placement.
- Loading, empty, error, retry, and incremental-load states are required.
- Pagination uses smooth incremental “Load more” behavior without replacing
  already rendered rows or losing scroll position.
- Inline editing must provide visible saving/error feedback.
- Entity rows expose `Open entity` at the top-right of the Name cell. The Entity
  window and Entity-created Document use a Notion-style property section with
  editable metadata and per-property visibility controls.
- A Space opens its editable default Overview Dashboard. Folder clicks only
  disclose hierarchy and never replace the current work area.
- Keep the context tree compact (roughly 232 px on desktop) and quiet; primary
  work stays in the canvas, while hierarchy uses small filled icons and muted
  supporting text.
- A field's editor must expose every field action available from its column
  menu. Insert-left/right always opens a named, typed field form before any
  schema change is persisted.
- Required fields are visibly marked in entity creation/import flows and block
  completion until they have valid values. Numeric zero and a false checkbox
  are valid required values.
- Changing an editable Field type always opens a portalled preview before
  applying. Show mapped, cleared and empty cell counts; call out permanent data
  loss explicitly. The preview is read-only and must not mutate the Field or
  Entity values. Computed, identity, Relation and Files types remain locked.
- Calculate menus are field-type aware. Numeric operations only appear for
  Number, Rating and Progress, while count/fill operations remain available to
  all fields. Legacy or invalid operations must never break the work area.
- Use an anchored, portalled colour palette with labels and a selected state;
  it must never be clipped by a popover or appear beneath an editor.
- A resource tree uses one fixed indent step per nested branch: the disclosure,
  branch rule and item icon share the same grid rhythm at every depth. Do not
  combine depth-based padding with nested branch margins.
- The context sidebar is a top-aligned workspace column, independent of the
  work-area global topbar. When a Database is opened through a Space placement,
  show its location breadcrumb but not a second database title/description
  header.
- Right-clicking a Layout opens its full item menu at the pointer: rename &
  icon, duplicate, pin/unpin to Space, then destructive delete. Other surfaces
  must use application menus rather than browser-native context menus.
- All Database is the canonical inventory, not a placement browser: do not
  render Space/folder hierarchy or placement counts there. Keep its compact
  action cluster right-aligned and vertically centred; reveal it on hover or
  keyboard focus.
- Tree item right-click and its ellipsis trigger must open the same item-specific
  menu at the pointer (Space, Folder, placement Database, and canonical
  Database). Hover action glyphs use the tree-icon scale with a compact 20 px
  hit target, never oversized toolbar controls.
- A pinned placement Layout is an in-Space work-area tab. Selecting it must
  swap the canvas to that placement's Database/Layout without URL navigation or
  changing the selected Space. Space Overview hides its duplicate space title,
  description and icon header.
- Table pagination, New entity and calculation results share one compact 32 px
  footer. Pagination and creation begin at the left edge; calculations follow
  inline and record count remains right-aligned.
- Tables use visible vertical column borders and subtle horizontal row rules.
  Default field alignment is left; centre/right alignment is explicit field
  configuration. Frozen columns carry a stronger vertical divider and preserve
  row rules/hover feedback across the sticky boundary. Every field header uses
  its configured icon or the type's fallback icon.
- View action controls are compact 28 px outlined buttons. An active
  filter/sort/group/customize state uses the primary tint, rather than changing
  the toolbar layout or consuming extra work-area height.
- Layout tabs signal the open view with a clear primary underline/tint. Do not
  reveal a settings or overflow control on hover; expose layout management via
  the application context menu (right-click) and Rename & icon flow.
- At 100% browser zoom, the standard Table canvas targets roughly 25 visible
  entity rows: use a 32 px header and 30 px data-row rhythm. Selection
  checkboxes are centred in one fixed column; never place a row drag handle in
  that selection column.
- Where row ordering is enabled, its drag handle belongs in a narrow gutter
  outside the data grid, never in the selection column. In hierarchy mode,
  show the disclosure beside the Name value whenever a parent has children;
  keep Add sub-item hidden during general row hover and reveal it only when
  its own hit area is hovered or keyboard-focused. Creating a child must
  immediately render it under its expanded parent even when it would otherwise
  fall outside the currently fetched server page. Supply the required Entity
  name during that creation flow. Paginated Entity results and optimistic
  inserts must be de-duplicated by Entity ID before rendering.
- Loading a Table page in hierarchy mode must also load the complete connected
  Sub-item tree for the Entities on that page. Recursive rendering is
  cycle-safe and may render a given Entity ID only once. Deleting an Entity
  must remove it from both paginated data and all active Sub-item-tree caches
  immediately.
- `Parent item` is a searchable single-select even though relation data is
  transported as an ID list. An Entity may have only one parent; assigning a
  new parent detaches the previous parent link regardless of whether the edit
  starts from `Parent item` or the parent's `Sub-item` field.
- A selected cell or selected row gives the complete row a restrained primary
  highlight.
- Checking an individual row enters row-selection mode: clear the active cell
  range and replace the previous row selection. Shift-check selects a
  contiguous row range; Cmd/Ctrl-check adds or removes one row while retaining
  the existing row selection. The header checkbox also clears any active cell
  range.
- Row content is vertically centred within the 30 px row rhythm. Selection
  outlines are non-layout overlays: they must never change row height, move the
  grid, or cover the frozen-column divider. An editing cell keeps the single
  outer cell outline; its input must not add a second focus background, border,
  or ring.
- Database chrome density is fixed: Global Topbar 32 px; Database Context,
  Layout bar and View controls 28 px each. Use the matching compact font/icon
  scale rather than shrinking only the container.
- Dense Table uses a 32 px header, 30 px rows, 11 px body text and a 26 px
  footer. A frozen-column divider is stronger than ordinary grid borders.
  Cell selection is a primary outline around the cell; row selection is an
  outline around the row. Never use a selection fill or allow the two
  selection modes to coexist.
- A multi-cell range draws one continuous primary border around the complete
  rectangular region; never draw a separate full outline around every cell.
  Consecutive checkbox-selected rows use the same contiguous-region treatment.
- A selected scrolling cell must remain beneath sticky frozen columns. Raise
  z-index only for the selected cell when that cell itself belongs to the
  frozen pane.
- A frozen boundary is an inset divider owned by the final sticky column, not
  an edge painted by the scrolling grid. Keep the frozen pane above row hover
  and normal-cell selection layers at every horizontal scroll offset.
- Layout and View controls use an 18 px horizontal inset and compact 11–12 px
  labels. The 28 px View-control row never scrolls vertically. Give it equal
  4 px breathing space above and below, without a divider against the work
  area.
- `Default View` is a real 24 px dropdown button and remains available even
  when no named preset exists. Dropdowns, settings rows and context menus use
  the same compact font scale and 28–32 px action rhythm.
- The Table footer has no full-width top divider. Load more and New remain on
  the plain footer surface; calculations and the record count share one
  bordered box that expands through the remaining width.
- List rows use the Table body scale (11 px text, 30 px rhythm) and keep inline
  properties constrained so the primary name remains scannable. Board columns
  consume the remaining work-area height, use compact 11 px cards and scroll
  inside each column rather than shortening the whole board. Gallery uses the
  same 11 px scale, 220 px minimum cards and restrained 8 px gaps.
- Timeline date-field and scale controls live beside `Default View` as compact
  value-only dropdown buttons. Do not repeat labels such as “Timeline by” or
  “Time period” in the toolbar. The Unscheduled tray is collapsible.
- Calendar navigation, current period and display mode live in the same
  View-control row. Keep the all-day rail aligned to the day grid; overlapping
  timed events share horizontal lanes inside their collision group instead of
  painting on top of each other.
- Call schema configuration `Edit Field`, pair the heading and field list with
  the configured field icon, and avoid the ambiguous “Edit Properties” label.
- An Entity-created Document remains linked to its source Entity. Reopening the
  Entity shows the document below the Fields section in an embedded editable
  surface, with an expand action for the full document window. Per-field
  `entity_doc_visible` settings define the database-wide default metadata
  visibility for entity documents.

## Language and copy

- Product UI currently uses concise English labels in the Database Engine and
  may contain Vietnamese in surrounding areas until the i18n pass.
- Errors must explain the recovery action, not only state that an operation
  failed.
