# VHB Super App — Working Memory

## Project

VHB Group's internal B2B trading/export super app, intended to replace a mature
Notion business hub and a lightly used ClickUp setup. The current priority is the
Notion-style dynamic database engine; tasks, docs, design tools, realtime, storage,
and deployment are later epics.

## Current Architecture

| Area | Decision |
|---|---|
| Frontend | Next.js **16.2.9**, React 19, TypeScript, Tailwind 4, shadcn/Base UI, TanStack Query |
| Backend | Python 3.12, FastAPI async, Pydantic v2, SQLAlchemy 2 async, Alembic, `uv` |
| Database | Self-hosted/local PostgreSQL 16 via `docker/docker-compose.yml`; no Supabase |
| Auth | FastAPI email/password auth, Argon2 hashes, app-issued HS256 JWT |
| API types | Generated from FastAPI OpenAPI into `frontend/src/lib/api/schema.ts` |
| Data model | Fixed meta-schema; dynamic row values in JSONB keyed by field UUID |
| Authorization | FastAPI owns authz; every data query must be workspace-scoped |

Accepted decisions: `docs/adr/0001-dynamic-schema.md` and
`docs/adr/0002-authz-model.md`. ADR 0002 contains stale Supabase wording, but its
core rule—FastAPI-owned, workspace-scoped authorization—still applies.

## Current Product State

- Six persisted layouts exist: Table, Board, List, Calendar, Gallery, and Timeline/Gantt.
- View config, presets, filters, sorts, grouping, visibility, calculations, and layout
  settings are persisted through the `View` API.
- The dynamic engine includes relation, rollup, formula, sub-items, system fields,
  bulk rows, field/row reorder, and multiple field editors.
- Latest committed baseline: `d995b70` on `feature/26.06.05` and `main`.
- Last documented green baseline: frontend typecheck/lint/16 tests/build; backend
  ruff/mypy/27 tests.
- The working tree contains uncommitted UI polish in Board/Calendar/Gallery/List and
  `frontend/src/lib/view.ts`. Preserve these user changes.
- On 2026-07-01, all six database views received responsive shared-toolbar/sidebar
  polish plus view-specific Board/List/Gallery/Calendar/Timeline UX fixes; frontend
  typecheck, lint, 16 tests, production build, and browser QA passed.
- `PRODUCTION_PLAN.md` is now the active roadmap. Foundation F2.1 (Space/Folder
  resource tree and optional `Database.folder_id`) shipped on 2026-07-02 with
  migrations and workspace-isolation tests.
- Foundation F3 (authorization v2) and F4 (bounded server-side row queries)
  shipped on 2026-07-02. The next production slices are F5 object storage and
  F6 durable jobs.
- Foundation F5 uses an S3-compatible `ObjectStorage` interface with local
  MinIO. F6 uses PostgreSQL durable jobs with leases, `SKIP LOCKED`, retry
  backoff, idempotency keys, and the `python -m app.worker` process.
- F7–F9 add immutable audit/outbox events, Redis-backed JWT sessions and auth
  rate limits, readiness/Prometheus metrics, production secret validation,
  backup scripts, and GitHub CI.

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
| Full memory index | `MEMORY.md` |
| Current implementation history | `build-progress-m1.md`, `CHANGELOG.md` |
| Product requirements and roadmap | `SPEC.md`, `PLAN.md` (some stack wording is stale) |
| Field catalog | `docs/field-catalog.md` |
| Business context | `user-vhb-group-business.md` |
| UX dropdown rule | `ux-dropdown-no-native-menus.md` |
| Frontend local instructions | `frontend/AGENTS.md`, `frontend/CLAUDE.md` |
