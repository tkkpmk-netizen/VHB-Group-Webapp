# VHB Platform — Production Roadmap

Status: **Active — DP7 realtime collaboration MVP complete; Design & Publishing phase complete**
Updated: 2026-07-17

Verified baseline:

- Alembic: `d5a7c9e1f3b5 (head)`, no schema drift.
- Backend: ruff + mypy + 85/85 tests.
- Frontend: typecheck + lint + 20/20 tests + production build.

## Product Direction

VHB Platform is a modular application shell. Every mini app may bind to the
dynamic Database Engine for business data, while platform concerns such as
identity, documents, designs, builds, deployments, notifications, assets, and
permissions use first-class models.

Target modules:

1. Database
2. Workspace / Space / Folder
3. Documents
4. Space-owned Dashboard Designer
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
- Entity listing is paginated and bounded.
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

## Design and Publishing (DP)

Ordering rule: the Site domain and its dependencies stay after Phase 2 —
data binding reuses Dashboard query patterns, and publishing requires
stable jobs/notifications. If Web Designer must be pulled earlier, it may
start no sooner than after CM3.

| ID | Initiative | Depends on | Status |
|---:|---|---|---|
| DP1 | Site/Page/DataBinding domain | F2, F3, F4, F5, CM3 | MVP completed |
| DP2 | Public Runtime API | DP1, F3, F8, F9 | MVP completed |
| DP3 | Web Designer using GrapesJS project JSON | DP1, F5 | MVP completed |
| DP4 | Penpot/Figma import pipeline (design locally; import artifacts through assets — Penpot/Figma are never embedded in the server) | DP3, F5, F6 | MVP completed |
| DP5 | Build and Deployment pipeline | DP1, F5, F6, F9 | MVP completed |
| DP6 | Domains, environments and rollback | DP5 | MVP completed |
| DP7 | Realtime collaboration for Docs/Design | Documents, F7, F8 | MVP completed |

## Database Layout Expansion (Planned)

Two Layout types are planned but not yet built. Both are documentation/
roadmap only for now — see
[ADR 0017](docs/adr/0017-entity-layout-datasource-viewpreset.md) for the
Entity/Layout/DataSource/ViewPreset model these will build on.

| ID | Initiative | Depends on | Status |
|---:|---|---|---|
| LO1 | Form Layout — a data-entry form view of a Database (one Entity per submission), reusing Field validation from the engine | Database engine, F4 | Planned |
| LO2 | Dashboard-as-a-Layout — surface an existing Dashboard as a selectable Layout type on a Database, alongside Table/Board/etc. | CM4, Layout API | Planned |

## Architecture Rules

- Dynamic `Entity.data` stores business data, not platform metadata.
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
- Workspace-level `Database` inventory independent of Space/Folder ownership.
- `SpaceDatabasePlacement` as the many-to-many boundary between Space and
  Database, with optional Folder/Layout, order, and per-Space display settings.
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

- Space-owned Dashboards, one required default Dashboard per Space, and
  query-bound Metric, Bar, and Table widgets.
- F4 `RowQuery` grouped aggregations, bounded to 100 groups for chart sources.
- Dashboard CRUD, widget CRUD/data APIs, CM3 authorization, and automatic grant
  cleanup.
- Dashboard designer rendered directly when its Space is opened, with inline
  metadata editing, shared access, bindings restricted to Databases placed in
  that Space, and 30-second data refresh.

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

DP1 introduced:

- Workspace-scoped Sites with global slugs, optional folder placement, publish
  state, homepage path, CM3 `ResourceGrant` support, and audit event creation.
- Site Pages with per-site unique paths, JSON content source, publish state, and
  ordering.
- Site Data Bindings that attach a bounded F4 `RowQuery` to a database and
  explicitly whitelist public `field_ids`.
- Sites UI in the product rail with site creation, publish/unpublish, page JSON
  editing, binding creation, and Share access management.

DP2 introduced:

- Restricted unauthenticated public runtime endpoints under `/public/sites`.
- Published-site and published-page checks before any public response.
- Runtime binding reads that execute the saved query but prune every row to the
  binding's whitelisted `field_ids`.
- Public page manifest including only published pages and public binding
  summaries.

DP3 introduced:

- GrapesJS-backed Web Designer mounted inside the Sites workspace UI.
- `SitePage.content` now stores editor source as a `grapesjs` project envelope;
  generated HTML remains a future build artifact.
- Designer block palette for Hero, Section, Text, Button, Image, and Data
  Binding markers.
- Live canvas with desktop/tablet/mobile device modes, style inspector, reset,
  and explicit save to `PATCH /site-pages/{id}`.
- New site pages default to GrapesJS-compatible project JSON instead of raw
  `{blocks: []}` content.

DP4 introduced:

- `POST /site-pages/{page_id}/import-design` for replacing a page's designer
  source with an imported design artifact.
- Import payloads for generic HTML/CSS, Figma HTML/export, Penpot HTML/export,
  and GrapesJS project JSON.
- Backend normalization to the same `type: "grapesjs"` content envelope used by
  DP3, with import metadata stored in `content.meta`.
- Conservative server-side sanitizer that strips scriptable HTML attributes,
  executable tags, `javascript:` URLs, and dangerous CSS constructs from
  imported HTML/CSS artifacts.
- Site Manager UI panel for uploading `.html`, `.css`, or `.json` artifacts, or
  pasting HTML/CSS/project JSON directly into the selected page.

DP5 introduced:

- `SiteDeployment` records with version, status, job id, artifact asset id,
  entry path, manifest, and error state.
- Migration `4f6a8c0d2e1b` for the deployment table.
- `POST /sites/{site_id}/deployments` to enqueue a durable `site.build` job.
- Worker handler that builds published site pages into a static HTML artifact
  stored in object storage as an `Asset`.
- Public deployment metadata endpoint `/public/sites/{slug}/deployment`.
- Public render endpoint `/public/sites/{slug}/render[/path]` that serves the
  latest ready deployment artifact only when the site is published.
- Generated artifact runtime that hydrates `data-vhb-binding` markers by calling
  the restricted DP2 public binding API.
- Site Manager Deploy panel with Build & deploy action, polling deployment
  statuses, and latest deployment preview link.

DP6 introduced:

- `production` and `preview` deployment environments.
- Active deployment selection per site/environment, with latest-ready fallback
  for older deployment records.
- Rollback/promote endpoint `POST /site-deployments/{deployment_id}/promote`.
- Build jobs auto-activate the successful deployment in its environment.
- `SiteDomain` domain mappings with hostname, environment, verified and primary
  state.
- Domain management APIs under `/sites/{site_id}/domains` and `/site-domains`.
- Public domain render endpoints under `/public/domains/{hostname}/render`.
- Site Manager controls for environment builds, active deployment preview,
  rollback/promote, domain creation, verification marking, primary domain and
  removal.

DP7 introduced:

- WebSocket collaboration endpoint
  `/collaboration/ws/{resource_type}/{resource_id}`.
- Token + active session + workspace scoped authorization for realtime rooms.
- Collaboration rooms for `document` and `site_page` resources.
- Presence snapshot, join and leave events.
- Ephemeral collaboration events for cursor, selection, document content
  changes and design changes.
- Shared frontend `useCollaboration` hook.
- Document editor presence avatars and content-change broadcast while preserving
  the existing optimistic autosave as source of truth.
- Web Designer presence avatars and design-change broadcast on save/reset.
- In-process hub contract that can be replaced by Redis pub/sub fanout later
  without changing frontend event payloads.

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
