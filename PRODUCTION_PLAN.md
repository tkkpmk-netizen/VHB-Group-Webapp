# VHB Platform — Production Roadmap

Status: **Active — Foundation and Core Functions complete; Design/Publishing next**
Updated: 2026-07-07

Verified baseline:

- Alembic: `2b4d6f8a0c1e (head)`, no schema drift.
- Backend: ruff + mypy + 62/62 tests.
- Frontend: typecheck + lint + 16/16 tests + production build.

## Product Direction

VHB Platform is a modular application shell. Every mini app may bind to the
dynamic Database Engine for business data, while platform concerns such as
identity, documents, designs, builds, deployments, notifications, assets, and
permissions use first-class models.

Target modules:

1. Database
2. Workspace / Space / Folder
3. Documents
4. Dashboard Designer
5. Web Designer
6. Sites / Deployments
7. Identity / Administration
8. Notifications
9. Import / Export

The initial architecture remains a **modular monolith** (Next.js + FastAPI +
PostgreSQL), with separate workers for asynchronous workloads. Services are
split only when production load or isolation requirements justify it.

## Dependency Order

```text
Resource tree + permissions
        │
        ├── Object storage ── Import/Export
        │                  └─ Design/Document assets
        ├── Job system ───── Email/Notifications
        │                └── Build/Deployment
        ├── Query API ────── Dashboard/Data binding
        └── Public API ───── Published sites
```

## Now — Foundation

| ID | Initiative | Outcome | Status |
|---|---|---|---|
| F1 | Modular boundaries | Backend/frontend organized by platform module | Completed |
| F2 | Resource tree | Workspace → Space → Folder → resources | Completed |
| F3 | Authorization v2 | Explicit workspace selection, roles and database grants | Completed |
| F4 | Server data queries | Bounded pagination/filter/sort/aggregation | Completed |
| U1 | ClickUp-style product shell | App rail, workspace switcher, hierarchy sidebar | Completed |
| U2 | Foundation management UI | Space/Folder, People/Roles, database grants | Completed |
| U3 | Database query UX | Server pagination and bounded record counts | Completed |
| U4 | Database view consistency | Shared dense toolbar/chrome across all views | Completed |
| F5 | Object storage | S3-compatible asset abstraction, MinIO locally | Completed |
| F6 | Job infrastructure | Durable jobs for import, email, build, thumbnails | Completed |
| F7 | Audit/events | Domain events and immutable audit trail | Completed |
| F8 | Cache/session | Redis-backed sessions, cache and rate limiting | Completed |
| F9 | Production baseline | Config validation, observability, backup and CI gates | Completed |

Foundation exit criteria:

- Resources can be organized and authorized below workspace level.
- No API relies on “first workspace” as the final tenancy model.
- Row listing is paginated and bounded.
- Long-running work is never executed in request handlers.
- Files are stored through an object-storage interface.
- Security-sensitive changes emit an audit record.
- Backend and frontend quality gates run in CI.

## Core Functions

Phase 1 closes out Core Functions; Phase 2 composes them into broader product
capabilities.
CM3 provides generic grants for Documents and Dashboards. Sites must reuse the
same policy instead of inventing another permission table.

### Phase 1 — Finish what is started

| Order | Initiative | Depends on | Status |
|---:|---|---|---|
| CM1 | CSV/XLSX Import and Export — upload, durable job progress and downloadable export | F4, F5, F6, F7 | Completed |
| CM2 | Block Documents — BlockNote editor, autosave, version conflicts and document navigation | F2, F3, F5, F7 | MVP completed |

### Phase 2 — Composed Core Functions

| Order | Initiative | Depends on |
|---:|---|---|
| CM3 | Generic `ResourceGrant` (resource_type + resource_id), generalizing `DatabaseGrant`; centralized enforcement reused by Documents/Dashboards/Sites | F3 | Completed |
| CM4 | Dashboard Designer — widgets bound to the F4 query API (aggregations as data source) | F3, F4, F8, CM3 | MVP completed |
| CM5 | Google OAuth and account linking | F3, F7, F8 | Completed; provider configuration required |
| CM6 | In-app notifications (bell + Redis) and email notifications (outbox → job worker) | F3, F6, F7, F8 | MVP completed; SMTP configuration required |
| CM7 | Database Files & Media field backed by Google Drive Shared Drive storage | F3, F4, F6 | MVP completed; Google Drive service account configuration required |

## Later — Design and Publishing

Ordering rule: the Site domain and its dependencies stay after Phase 2 —
data binding reuses Dashboard query patterns, and publishing requires
stable jobs/notifications. If Web Designer must be pulled earlier, it may
start no sooner than after CM3.

| Order | Initiative | Depends on |
|---:|---|---|
| 1 | Site/Page/DataBinding domain | F2, F3, F4, F5, CM3 |
| 2 | Public Runtime API | Site domain, F3, F8, F9 |
| 3 | Web Designer using GrapesJS project JSON | Site domain, F5 |
| 4 | Penpot/Figma import pipeline (design locally; import artifacts through assets — Penpot/Figma are never embedded in the server) | Web Designer, F5, F6 |
| 5 | Build and Deployment pipeline | Site domain, F5, F6, F9 |
| 6 | Domains, environments and rollback | Deployment pipeline |
| 7 | Realtime collaboration for Docs/Design | Documents, F7, F8 |

## Architecture Rules

- Dynamic `Row.data` stores business data, not platform metadata.
- Platform resources use typed tables with migrations and auditability.
- Published websites use a restricted Public Runtime API, never admin APIs.
- Editor project JSON is the source of truth; generated HTML is a build artifact.
- Large files and generated artifacts live in object storage, not PostgreSQL.
- Email, imports, exports and builds run as jobs with retry and idempotency.
- Authorization checks are mandatory at every resource boundary.

## Delivered Foundation Slices

F2.1 introduced:

- `Space` scoped to a workspace.
- Nested `Folder` scoped through its space.
- Optional `Database.folder_id`; existing databases remain at workspace root.
- Workspace-isolated CRUD APIs and cross-workspace rejection tests.

F3 introduced:

- Explicit `X-Workspace-ID` selection; multi-workspace accounts cannot use an
  implicit first workspace.
- Workspace owner/admin/editor/viewer roles and member management.
- Database viewer/editor/manager grants with centralized enforcement.
- Frontend workspace selection persisted and attached by the API client.

F4 introduced:

- `POST /databases/{database_id}/rows/query` with bounded page sizes.
- PostgreSQL-side filters, multi-column sorting, and aggregations.
- Total/page metadata and hard limits for query clauses.
- Legacy row listing bounded to 200 rows with offset/limit support.

F5 introduced:

- Workspace-scoped asset metadata and generated object keys.
- S3-compatible `ObjectStorage` interface with a MinIO local adapter.
- Presigned upload/download URLs, completion verification, list, and delete APIs.
- Docker-managed MinIO, persistent volume, health check, and bucket bootstrap.

F6 introduced:

- PostgreSQL durable job state, retry limits, backoff, leases, and idempotency.
- Concurrent worker claims with `FOR UPDATE SKIP LOCKED`.
- Standalone `python -m app.worker` process and explicit handler registry.
- Workspace-scoped enqueue/list/get/cancel/retry APIs.
- Initial `system.noop` and `asset.verify` job handlers.

F7 introduced:

- Immutable workspace audit records enforced by a PostgreSQL trigger.
- Transactional outbox records written with security-sensitive changes.
- Admin-only audit API and worker-driven outbox publishing.

F8 introduced:

- Redis session registry keyed by JWT `jti`, including immediate logout revoke.
- Redis cache abstraction and fixed-window authentication rate limits.
- Redis local service with persistence and health checks.

F9 introduced:

- Production secret validation, request IDs, structured request logs, readiness,
  and Prometheus-compatible metrics.
- PostgreSQL/MinIO backup and PostgreSQL restore scripts.
- Backend and frontend GitHub Actions quality gates.

Foundation F1–F9 and UI modernization U1–U4 exit criteria are complete.

F1 introduced:

- A backend modular-monolith composition root with explicit identity, workspace,
  database, documents, transfers and governance ownership.
- Uniqueness tests for module names, routers and owned resources.
- A frontend product-module registry used by the shared application rail.

U4 introduced:

- Shared loading/error/retry feedback across Table, Board, Calendar, Gallery,
  List and Gantt.
- Consistent dense database chrome, toolbar placement, empty states and keyboard
  behavior.

CM1 introduced:

- CSV/XLSX upload through object storage and durable import jobs.
- Field matching plus optional typed field creation, bounded to 100,000 rows.
- Background CSV/XLSX exports with downloadable asset results.
- Database Import/Export UI with live job status.

CM2 introduced:

- Workspace-scoped BlockNote documents and document navigation.
- Atomic block JSON saves with optimistic version conflict detection.
- Debounced autosave and editable document titles.

CM3 introduced:

- Workspace-scoped polymorphic `ResourceGrant` with database, document, and
  dashboard resource types plus a migration preserving existing database grants.
- One centralized policy for read/write/manage actions, with resource roles
  overriding workspace defaults while owner/admin retain full access.
- Generic grant CRUD, audit events, cleanup on resource deletion, and a shared
  Share dialog used by Databases and Documents.

CM4 introduced:

- Workspace-scoped Dashboards and query-bound Metric, Bar, and Table widgets.
- F4 `RowQuery` grouped aggregations, bounded to 100 groups for chart sources.
- Dashboard CRUD, widget CRUD/data APIs, CM3 authorization, and automatic grant
  cleanup.
- Dashboard list/designer UI with inline metadata editing, shared access,
  database/field binding, and 30-second data refresh.

CM5 introduced:

- Google Identity Services ID-token sign-in with server-side signature,
  audience, issuer, expiry, and verified-email validation through Google's
  official client library.
- Provider-subject identity accounts, OAuth-only users, explicit linking for
  existing password accounts, safe unlink rules, and audit events.
- Google sign-in on Login plus connected-account management in Account Settings.

CM6 introduced:

- Durable workspace/user notifications, read state, delivery preferences, and
  notification creation for membership and resource-access changes.
- Redis-cached unread counts, polling bell UI, mark-read/all-read actions, and
  self-service notification settings.
- Transactional `notification.created` outbox fanout to idempotent
  `notification.email` jobs with retryable SMTP delivery.

CM7 introduced:

- `files` database field type for attaching images and documents to rows.
- Google Drive service-account storage adapter targeting a configured Shared
  Drive folder; PostgreSQL stores only file metadata and row cell references.
- Authorized upload, inline preview, and delete APIs scoped by workspace,
  database, row, and field.
- Table UI for multi-file upload, authenticated in-app previews for images,
  PDFs and text files, and file deletion without public Drive links.
- Cleanup hooks that remove Drive objects when a file field, row, or database is
  deleted.

Terminology: these are **Core Functions**, not mini apps. Mini apps are later
composed experiences that consume Core Functions.

## UI Modernization Baseline

The U1–U4 modernization gate is complete. Preserve these baseline rules in all
new modules:

- Product shell and hierarchy navigation are shared by every mini app.
- Workspace, Space, Folder, People, Roles, and database grants are manageable
  without direct API calls.
- Table pagination uses the F4 server query contract.
- Table, Board, Calendar, Gallery, List, and Gantt share consistent density,
  toolbar placement, empty/loading/error states, and keyboard behavior.
