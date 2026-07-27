# ADR 0024: Database change history and import provenance

## Status

Accepted — 2026-07-27

## Decision

- Every reversible Database mutation writes a workspace-scoped
  `DatabaseChange`. A revision stores the actor, user-facing summary, action
  key, inverse snapshots for updated/deleted resources, and IDs of resources
  created by the mutation.
- History covers Database metadata, Fields, Entities, Entity links,
  DataSources, Layouts, and View Presets. Layout restoration also restores its
  presets and active-preset reference in dependency-safe order.
- Restoring a history item applies its inverse once and marks the revision with
  `reverted_at` and `reverted_by_id`. `Ctrl/Cmd+Z` restores the most recent
  unreverted Database revision; it does not override native undo while focus is
  inside an input, textarea, or content-editable surface.
- History remains protected by Database read authorization; restore and Undo
  require Database write authorization. Both paths remain workspace-scoped.
  The audit trail remains the immutable security record; Database history is
  the product-facing reversible state log.
- Import mapping is explicit per incoming column: map to an existing Field,
  create a Field, or `Don't Import`. Mapping to an existing Field locks its
  type. New Select/Multi-select/Status/Priority Fields preview and create their
  incoming options. All editable and provenance field types are available;
  UID, relation, rollup, and formula fields cannot receive imported JSONB cell
  values and must be skipped or represented by a new editable Field.
- The required incoming Name column maps to the canonical Name Field; UID stays
  server-generated. Incoming `Created time` and `Last edited time` values are
  parsed from spreadsheet-native dates, ISO timestamps, common day/month and
  month/day exports, or Unix epoch values, then written to `Entity.created_at`
  and `Entity.updated_at`. They are provenance, not ordinary JSONB cells.

## Consequences

History is compact and reversible without copying the whole Database after
every cell edit. Restoring an old item is an inverse operation rather than
time-travel to a complete historical snapshot, so newer unrelated revisions
remain. Import previews disclose created options and ignored columns before
the durable job starts; imported business timestamps retain their source
meaning instead of being replaced by the job execution time.
