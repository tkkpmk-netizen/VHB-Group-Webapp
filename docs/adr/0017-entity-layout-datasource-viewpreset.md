# ADR 0017 — Entity/Layout terminology, DataSource, and View Preset promotion

- Status: Accepted
- Date: 2026-07-08

## Context

The Database engine used code-shaped names — `Row` for a record, `View` for a
saved visual layout — instead of domain terms. The product needed to speak in
**Entity** (a record), **Field** (a column), **Cell** (a value in an entity),
and **Layout** (a saved way to view a database: Table/Board/Calendar/Gallery/
Gantt/List today; Form and a Dashboard-as-a-Layout integration are planned,
see `PRODUCTION_PLAN.md`).

Two structural gaps needed closing alongside the rename:

1. A `Database` had no notion of "where did this entity come from" — every
   import flattened into the same entity pool, with no way to filter a
   Layout down to just one import's entities.
2. "View Presets" (named, saved filter/sort/group snapshots) existed only as
   an opaque JSON blob nested inside `View.config` — the backend had zero
   knowledge of presets as a concept, and the frontend owned all persistence
   and identity (`crypto.randomUUID()`) for them.

## Decision

**Rename, all the way down** (DB tables, SQLAlchemy models, API routes,
Pydantic/OpenAPI schema names, generated frontend types, UI copy):

- `Row` → `Entity`; `RowLink` → `EntityLink` (table `rows`→`entities`,
  `row_links`→`entity_links`, FK columns `source_row_id`/`target_row_id` →
  `source_entity_id`/`target_entity_id`). Routes `/databases/{id}/rows` →
  `/entities`, `/rows/{id}` → `/entities/{id}`.
- `View` → `Layout`; `ViewType` → `LayoutType` (table `views`→`layouts`).
  Routes `/databases/{id}/views` → `/layouts`, `/views/{id}` → `/layouts/{id}`.
- **"View Preset" stays "View Preset"** (not "LayoutPreset") — it is the
  sub-concept nested inside a Layout, and this is the name the product uses
  for it.

**New `DataSource` model** (`app/models/data_source.py`): belongs to a
`Database`; `kind` is `manual` or `imported`; exactly one `is_primary` source
per database (partial unique index) is the fallback target for manually
created entities. `Entity.data_source_id` is `NOT NULL`, FK `ondelete=RESTRICT`
— deleting a source is blocked at the DB layer (and pre-checked in the API
for a clean 409) while it still has entities. `data_source_id` is filterable
as a third pseudo-field in the entity query engine, alongside the existing
`"seq"`/`"order"` special cases in `app/api/engine.py::_field_expression` —
no new query endpoint needed. Every database gets a `"Primary"` DataSource on
creation; every CSV/XLSX import creates (or reuses) a named DataSource and
stamps it onto every entity it creates.

**`ViewPreset` promoted out of `Layout.config`** into its own table
(`app/models/view_preset.py`), FK'd to its parent `Layout`.
`Layout.active_view_preset_id` (nullable, `ondelete=SET NULL`) tracks which
preset is applied — storing "active" on the parent avoids a duplicated
`is_active` flag per preset row. Applying a preset reuses the existing
`PATCH /layouts/{id}` endpoint with `active_view_preset_id` in the body
(checked via `model_fields_set`, not `is not None`, so callers can explicitly
clear it to `null`) rather than a dedicated `/apply` action — it is a
one-column write, not a business action.

## Migration

Four sequential Alembic revisions, each independently testable:

1. `8f1a3c5e7b2d` — rename `rows`→`entities`, `row_links`→`entity_links`
   (+ FK columns), `drive_files.row_id`→`entity_id`. All metadata-only
   renames (`ALTER TABLE ... RENAME`), no table rewrite.
2. `2d4f6a8c0e1b` — rename `views`→`layouts`.
3. `3e5a7c9f1b0d` — create `data_sources`; backfill one `"Primary"` source
   per existing database; add `entities.data_source_id` nullable, backfill
   to each database's primary source, then lock `NOT NULL` + add the FK.
4. `e8f0a2c4e6f8` — create `view_presets`; add `layouts.active_view_preset_id`;
   backfill existing `Layout.config->'presets'` (JSONB array, matched via
   `jsonb_array_elements ... WITH ORDINALITY`) into real rows, resolve
   `config->>'activePreset'` into the new FK, then strip both keys out of
   `config` now that `ViewPreset` is the source of truth. The backfill guards
   against malformed legacy preset ids with a UUID-format check before
   casting, so a corrupted `config` blob can't fail the whole migration.

`Layout.active_view_preset_id` and `ViewPreset.layout_id` form a circular FK
between two tables — the model declares an explicit constraint name
(`fk_layouts_active_view_preset_id`) so SQLAlchemy's `drop_all` (used by the
test fixture) can `DROP CONSTRAINT` to break the cycle; an unnamed FK would
raise `CircularDependencyError` on every test run.

## Consequences

- (+) Docs, API, generated frontend types, and UI copy all use the same
  domain vocabulary — no more translating "Row" → "record" in your head.
- (+) DataSource lets a database aggregate multiple imports without losing
  the ability to look at (or filter to) just one of them.
- (+) View Presets are now real, workspace-authorized, server-validated
  resources instead of a client-trusted blob — they show up in migrations,
  can be queried/audited, and don't depend on the frontend generating a
  collision-free id.
- (−) Renaming two core tables end-to-end touched roughly 15 backend files,
  15 frontend files, and the full OpenAPI-generated client — a large,
  mechanical diff. Mitigated by doing it in four independently-tested phases
  (rename Entity → rename Layout → DataSource → ViewPreset) rather than one
  combined migration.
- (−) `Entity.data_source_id` being `NOT NULL` means every code path that
  creates an entity (manual create, bulk create, spreadsheet import) must
  resolve a `data_source_id` — enforced via `_resolve_data_source()` in
  `app/api/engine.py`, defaulting to the database's primary source when the
  caller doesn't specify one.

## Alternatives considered

- **`data_source_id` as a query param** on the entity list endpoint only,
  instead of a query-engine pseudo-field: rejected because the query/filter
  endpoint (`POST /entities/query`) already composes filters/sorts/group-by
  generically over `_field_expression`; a bespoke param would need its own
  AND-composition and wouldn't support sorting or grouping by source without
  duplicating that machinery.
- **Cascade-delete entities when a DataSource is deleted**: rejected as the
  default — a metadata-looking delete silently destroying data is a bad
  default for a destructive action. Blocking (409 while non-empty) is the
  simpler, safer choice; reassignment-before-delete is a distinct feature not
  requested here.
- **Dedicated `POST /view-presets/{id}/apply` endpoint**: rejected — applying
  a preset has no side effects beyond setting one FK column on the parent, so
  a dedicated action endpoint would just be a thin wrapper around the same
  one-column write the generic `PATCH /layouts/{id}` already does.
