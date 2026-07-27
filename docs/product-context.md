# VHB Platform Product Context

## Product vision

VHB Platform is an internal operating system that combines flexible
Notion-style data/documents with ClickUp-style execution. All composed
experiences use the dynamic Database Engine as their business-data foundation,
while identity, permissions, documents, dashboards, assets, notifications,
sites, and deployments remain first-class platform resources.

The product is a web application. Next.js provides the user interface and calls
the FastAPI REST API; FastAPI owns business logic, authorization, and all data
access.

## Business context

VHB Group operates a B2B food trading/export business, including the M-Pacific
brand, international exhibitions, and relationships with customers, suppliers,
and large partners.

The existing Notion workspace is the mature system of record:

- CRM and company/nation/source data
- Order and inquiry management
- Sourcing and supplier databases
- Marketing and master-data workspaces
- Task/Second Brain workflows and automations

The existing ClickUp workspace is mostly a lightly populated GTD template.
Realistic product workflows and sample data should therefore follow the richer
Notion business model rather than the ClickUp demo data.

## Product principles

1. Business records live in the dynamic Database Engine.
2. Platform metadata uses typed, migrated, auditable tables.
3. Every resource is workspace-scoped and authorization is server-side.
4. Long-running work uses durable jobs; large assets use object storage.
5. Published websites use a restricted public runtime, never admin APIs.
6. Web/design tooling integrates focused open-source components rather than
   rebuilding Figma, Penpot, or a browser engine.
7. Editor source data and generated deployment artifacts remain separate.

## Delivered capability baseline

- Workspace, Space, Folder, member roles, and generic resource grants
- Workspace-level Database inventory plus Space-specific Database placements:
  a Database can appear in multiple Spaces, with an optional Folder, ordering,
  independently cloned Layout collection, and display settings stored per Space
- Dynamic databases (Entities/Fields/Cells) with Table, Board, List, Calendar,
  Gallery, and Gantt Layouts; Form and a Dashboard-as-a-Layout integration are
  planned (see [Production Plan](obsidian://open?vault=VHB%20Group%20Webapp&file=PRODUCTION_PLAN))
- Multi-source databases: a Database holds one or more DataSources (manual or
  imported); every Entity belongs to exactly one, and Layouts can filter to a
  single source. Non-primary sources can be merged transactionally into another
  source while preserving every Entity and Database change history.
- Every Database has one required canonical Name Field; all Field labels are
  database-scoped and unique. Name can be promoted from another compatible
  Field without creating a second identity column.
- Named, server-persisted View Presets (saved filter/sort/group snapshots)
  per Layout, with one markable as the Layout's active preset
- FTP-style Space Management with stable drop-target reordering and a
  canonical Database bar; placement Layout edits never affect another Space
- Per-user Database Favorites pinned to the Context Sidebar without changing
  canonical inventory or Space placements
- Relations, rollups, formulas, system fields, filters, sorts, grouping, and
  bounded server queries
- Grouped Tables use server totals, independent lazy loading per expanded group,
  sticky group headers, and a persisted custom group order.
- Conditional colors persist per Layout and can target rows/cards,
  groups/columns, or both. They support custom Field conditions and original
  tag colors from Select, Status, Multi-select, and Priority.
- Board uses exact server group summaries, shows ten groups at first, paginates
  each group independently, and can order groups by Entity count or label.
- CSV/XLSX import and export through assets and durable jobs
- Product-facing Database change history with one-time revision restore and
  `Ctrl/Cmd+Z` for the latest reversible mutation. The history spans Database
  metadata, Fields, Entities, links, DataSources, Layouts, and View Presets.
- Import mapping explicitly supports existing Field, newly created Field, or
  `Don't Import`; created choice options are reviewed before import, mapped
  existing Fields retain their type, and source Created/Last edited timestamps
  retain their original values.
- BlockNote documents with autosave and optimistic versioning
- Documents can be created from an Entity, retain a workspace-scoped
  `source_entity_id`, and open as Notion-style pages with editable, hideable
  Entity metadata in a popup editor above the Entity editor
- Persisted Font Awesome 5 and Material Design icons for Spaces, Folders,
  Databases, Layouts, Fields, and Documents. The shared searchable picker
  exposes all supplied styles (filled, outlined, rounded, sharp and two-tone)
  and preserves legacy solid-icon identifiers.
- Space-owned Dashboards with one default Dashboard per Space and query-bound
  editable `Overview`, plus query-bound Metric, Bar, and Table widgets sourced
  only from Databases placed in that Space
- Searchable Relation, Country, Select and Multi-select popovers, with the full
  country/territory catalog and plain numeric Entity IDs unless a prefix is set
- Email/password and Google identity with explicit account linking
- In-app notifications and outbox-driven SMTP email jobs
- Google Drive-backed Database Files & Media field with in-app previews
- Site/Page/DataBinding domain and restricted Public Runtime API
- GrapesJS-backed Web Designer storing project JSON in page source
- Design import pipeline for local Figma/Penpot/static HTML artifacts
- Build/deployment pipeline producing object-storage HTML artifacts
- Deployment environments, custom domains, and rollback/promote controls
- Realtime collaboration presence/events for Documents and Web Designer
- Audit trail, Redis sessions/cache, observability, backups, and CI

## Active roadmap

The authoritative delivery sequence and current status live in
[Production Plan](../PRODUCTION_PLAN.md). Design & Publishing DP1-DP7 is
complete at MVP level; use the roadmap to choose the next production phase.

Historical implementation details belong in [Changelog](../CHANGELOG.md), not in
parallel plans or memory files.
