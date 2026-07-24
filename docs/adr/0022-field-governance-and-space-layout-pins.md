# ADR 0022: Field governance, compact editing, and Space layout pins

## Status

Accepted — 2026-07-23

## Context

Database fields can represent mandatory business data and need controls that
remain consistent whether a person creates an Entity manually, bulk-creates it,
or imports a spreadsheet. Field editing also had two divergent entry points: a
column popover and the Customize panel. Space-specific Layouts need a lightweight
way to surface a useful view beside a Space's Overview dashboard.

## Decision

### Required values and edit permission

- A Field persists `options.required` and `options.edit_permission`.
- Required validation runs after the system name mirror on entity create, update,
  bulk create, and spreadsheet import. Empty strings, empty arrays and missing
  values fail; `0` and `false` remain valid values.
- Computed/system-generated fields are never required. The required Name is
  fulfilled from `Entity.name`.
- Spreadsheet imports reject a missing mapping for an existing required field
  and identify the source row when a mapped required value is empty.
- `edit_permission` is either `workspace` (all editors) or `admins` (workspace
  owners/admins only). Only owners/admins may tighten or loosen that policy.

### Field editing

The Field editor is the complete editing surface. It includes sort, group,
filter, wrapping, calculation, freezing, insert-left/right and delete in
addition to configuration. Insert actions always open the full field form;
they never create an unnamed implicit text field. Field type is represented by
its icon rather than a repeated type label.

Cell alignment is stored in field options (`auto`, `left`, `center`, `right`).
Auto right-aligns numeric/identifier values and left-aligns other values.

### Layouts and Space navigation

- The default saved preset is named **Default View**.
- Canonical and placement Layouts can be renamed, receive an icon, duplicated
  and deleted (while preserving at least one Layout).
- A placement Layout can set `config.pinned_to_space`. Pinned Layouts appear as
  navigable tabs immediately next to a Space's Overview and remain scoped to
  that placement; they never alter the canonical Database or another Space.

### Interaction density

The context tree is intentionally narrower and uses quiet 12–13 px icons.
Typography uses a stronger title/body/muted hierarchy. Date popovers calculate
their anchor before rendering, avoiding the first-open `(0,0)` flash. Option
colour selection uses a labelled, portalled palette so it does not clip behind
the field editor.

## Consequences

- API consumers receive clear 403/422 responses for protected or incomplete
  entity writes.
- Import clients must map every required non-system field before executing.
- Space landing pages can surface operational database layouts without turning
  a Space dashboard into a separate mini application.
