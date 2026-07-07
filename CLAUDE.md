# VHB Super App — Working Memory

## Project

VHB Group's internal B2B trading/export super app, intended to replace a mature
Notion business hub and a lightly used ClickUp setup. Foundation F1–F9, UI
modernization U1–U4, Core Functions CM1–CM7, and Design & Publishing DP1–DP4
are complete. The next product phase is DP5 Build and Deployment pipeline.

## Current Architecture

| Area | Decision |
|---|---|
| Frontend | Next.js **16.2.9**, React 19, TypeScript, Tailwind 4, shadcn/Base UI, TanStack Query |
| Backend | Python 3.12, FastAPI async, Pydantic v2, SQLAlchemy 2 async, Alembic, `uv` |
| Database | Self-hosted/local PostgreSQL 16 via `docker/docker-compose.yml`; no Supabase |
| Auth | FastAPI email/password + Google Identity, Argon2 hashes, app-issued HS256 JWT |
| API types | Generated from FastAPI OpenAPI into `frontend/src/lib/api/schema.ts` |
| Data model | Fixed meta-schema; dynamic row values in JSONB keyed by field UUID |
| Authorization | FastAPI owns authz; every data query must be workspace-scoped |

Accepted decisions are recorded under `docs/adr/`.

## Current Product State

- Six persisted layouts exist: Table, Board, List, Calendar, Gallery, and Timeline/Gantt.
- View config, presets, filters, sorts, grouping, visibility, calculations, and layout
  settings are persisted through the `View` API.
- The dynamic engine includes relation, rollup, formula, sub-items, system fields,
  bulk rows, field/row reorder, and multiple field editors.
- Six database layouts exist: Table, Board, List, Calendar, Gallery, and
  Timeline/Gantt.
- Foundation F1–F9 and UI modernization U1–U4 are complete.
- Core Functions CM1–CM7 provide transfers, BlockNote documents, generic
  resource grants, dashboards, Google identity, notifications, and Google
  Drive-backed Database Files & Media.
- Design & Publishing DP1–DP4 provide Sites, Pages, Data Bindings, the
  restricted Public Runtime API, a GrapesJS-backed Web Designer, and local
  Figma/Penpot/static artifact import into designer source.
- Current green baseline: backend ruff/mypy/66 tests; frontend
  typecheck/lint/16 tests/production build.
- Alembic head: `3c5e7f9b0d1a`.
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
- Relation values live in `RowLink`; rollup/formula/system values are computed and
  must not be persisted as ordinary `Row.data`.
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
| UX rules | `docs/ux-guidelines.md` |
| Architecture decisions | `docs/adr/` |
| Frontend local instructions | `frontend/AGENTS.md`, `frontend/CLAUDE.md` |
