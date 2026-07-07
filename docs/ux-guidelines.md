# UX Guidelines

These rules apply to every current and future module.

## Choice controls

- Never use native `<select>` or OS choice menus.
- Use the shared `Dropdown` and `MultiDropdown` components in
  `frontend/src/components/ui/dropdown.tsx`.
- Multi-select values appear as compact chips and are changed in a popover.
- Number inputs should not expose native steppers when a text/decimal interaction
  is more appropriate.

## Overlays and layout stability

- Menus, selection toolbars, and field forms float above content.
- Do not insert temporary panels that push a table, board, or document down.
- Portal overlays must remain inside the viewport, flip when space is limited,
  and appear above sticky headers/footers.

## Keyboard and mouse parity

- Every primary action must work with mouse and keyboard.
- `Enter` commits inline edits; `Escape` cancels or closes the active overlay.
- Dropdowns support arrow keys, Home/End, Enter, and Escape.
- Preserve focus when opening/closing popovers and expose accessible labels.

## Data views

- Use compact ClickUp-style density and consistent toolbar placement.
- Loading, empty, error, retry, and incremental-load states are required.
- Pagination uses smooth incremental “Load more” behavior without replacing
  already rendered rows or losing scroll position.
- Inline editing must provide visible saving/error feedback.

## Language and copy

- Product UI currently uses concise English labels in the Database Engine and
  may contain Vietnamese in surrounding areas until the i18n pass.
- Errors must explain the recovery action, not only state that an operation
  failed.
