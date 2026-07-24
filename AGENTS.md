# VHB Super App — Working Memory

## Project

VHB Group's internal B2B trading/export super app, intended to replace a mature
Notion business hub and a lightly used ClickUp setup. Foundation F1–F9, UI
modernization U1–U4, Core Functions CM1–CM7, and Design & Publishing DP1–DP7
are complete at MVP level.

## Current Architecture

| Area | Decision |
|---|---|
| Frontend | Next.js **16.2.9**, React 19, TypeScript, Tailwind 4, shadcn/Base UI, TanStack Query |
| Backend | Python 3.12, FastAPI async, Pydantic v2, SQLAlchemy 2 async, Alembic, `uv` |
| Database | Self-hosted/local PostgreSQL 16 via `docker/docker-compose.yml`; no Supabase |
| Auth | FastAPI email/password + Google Identity, Argon2 hashes, app-issued HS256 JWT |
| API types | Generated from FastAPI OpenAPI into `frontend/src/lib/api/schema.ts` |
| Data model | Fixed meta-schema; dynamic Entity values in JSONB keyed by Field UUID |
| Authorization | FastAPI owns authz; every data query must be workspace-scoped |

Accepted decisions are recorded under `docs/adr/`.

## Current Product State

- A Database is a collection of Entities (records; unique ID + required name).
  Entities carry Cells whose format matches their Field (column). A Database
  can hold multiple DataSources (e.g. distinct imports); each Entity belongs
  to exactly one DataSource, and Layouts can filter down to a single source.
- Six persisted Layouts exist: Table, Board, List, Calendar, Gallery, and
  Timeline/Gantt. Form and a Dashboard-as-a-Layout integration are planned —
  see `PRODUCTION_PLAN.md`.
- Layout config, filters, sorts, grouping, visibility, calculations, and
  layout settings persist through the `Layout` API. View Presets (named,
  saved filter/sort/group snapshots) are a separate persisted resource
  nested under a Layout, with `Layout.active_view_preset_id` marking which
  one is applied.
- The dynamic engine includes relation, rollup, formula, sub-items, system
  fields, bulk entity create, field/entity reorder, and multiple field
  editors.
- Foundation F1–F9 and UI modernization U1–U4 are complete.
- Core Functions CM1–CM7 provide transfers, BlockNote documents, generic
  resource grants, dashboards, Google identity, notifications, and Google
  Drive-backed Database Files & Media.
- Design & Publishing DP1–DP7 provide Sites, Pages, Data Bindings, the
  restricted Public Runtime API, a GrapesJS-backed Web Designer, and local
  Figma/Penpot/static artifact import into designer source, plus durable
  build/deployment artifacts, environments, domains, rollback and realtime
  presence/events for Docs/Design.
- Current green baseline: backend ruff/mypy/86 tests; frontend
  typecheck/lint/20 tests/production build.
- Alembic head: `e6b8d0f2a4c6`.
- Preserve unrelated dirty-worktree changes.

## Non-Negotiable UX Rules

- Never use native `<select>` or OS choice menus. Use the shared custom
  `Dropdown`/`MultiDropdown` components.
- Multi-select choices open in a popover and display selected values as chips.
- Menus, toolbars, and field forms must float/overlay; do not push table content.
- Match the current Notion/ClickUp-style interaction patterns and existing component
  conventions. Database UI is currently English; some surrounding shell text is Vietnamese.

## Engineering Rules and Gotchas

- Before changing Next.js behavior, read the relevant bundled docs under
  `frontend/node_modules/next/dist/docs/`; this project is on Next 16.
- Tests must use `vhb_test`, never the development database `vhb`. The test fixture
  drops and recreates tables.
- `Field.type` is VARCHAR, not a PostgreSQL enum; adding field types normally needs no
  migration.
- Relation values live in `EntityLink`; rollup/formula/system values are computed and
  must not be persisted as ordinary `Entity.data`.
- Every `Entity.data_source_id` must resolve to a `DataSource` in the same
  database; manual entity creation defaults to the database's primary source.
- Preserve workspace scoping on every backend query.
- Keep changes surgical and do not modify unrelated dirty files.

## Commands

```bash
cd docker && docker compose up -d db minio minio-init redis
cd backend && uv run pytest && uv run ruff check . && uv run mypy app
cd frontend && pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Backend dev: `cd backend && uv run uvicorn app.main:app --reload`

Worker dev: `cd backend && uv run python -m app.worker`

Frontend dev: `cd frontend && pnpm dev`

## Reference Map

| Need | Source |
|---|---|
| Current implementation history | `CHANGELOG.md` |
| Product requirements and roadmap | `docs/product-context.md`, `PRODUCTION_PLAN.md` |
| Field catalog | `docs/field-catalog.md` |
| Google Drive files design | `docs/adr/0010-google-drive-files-media.md` |
| Sites/public runtime design | `docs/adr/0011-sites-public-runtime.md` |
| Web Designer source model | `docs/adr/0012-web-designer-grapesjs-source.md` |
| Design import boundary | `docs/adr/0013-design-import-artifacts.md` |
| Site build/deployment artifacts | `docs/adr/0014-site-build-deployment-artifacts.md` |
| Domains, environments and rollback | `docs/adr/0015-domains-environments-rollback.md` |
| Realtime collaboration contract | `docs/adr/0016-realtime-collaboration-contract.md` |
| Entity/Layout rename, DataSource, View Preset | `docs/adr/0017-entity-layout-datasource-viewpreset.md` |
| UX rules | `docs/ux-guidelines.md` |
| Architecture decisions | `docs/adr/` |
| Frontend local instructions | `frontend/AGENTS.md`, `frontend/AGENTS.md` |
