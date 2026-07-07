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
- Dynamic databases with Table, Board, List, Calendar, Gallery, and Gantt views
- Relations, rollups, formulas, system fields, filters, sorts, grouping, and
  bounded server queries
- CSV/XLSX import and export through assets and durable jobs
- BlockNote documents with autosave and optimistic versioning
- Query-bound Metric, Bar, and Table dashboards
- Email/password and Google identity with explicit account linking
- In-app notifications and outbox-driven SMTP email jobs
- Google Drive-backed Database Files & Media field with in-app previews
- Site/Page/DataBinding domain and restricted Public Runtime API
- GrapesJS-backed Web Designer storing project JSON in page source
- Design import pipeline for local Figma/Penpot/static HTML artifacts
- Audit trail, Redis sessions/cache, observability, backups, and CI

## Active roadmap

The authoritative delivery sequence and current status live in
[Production Plan](../PRODUCTION_PLAN.md). The next phase covers DP5 build and
deployment pipelines, domains, environments, and rollback.

Historical implementation details belong in [Changelog](../CHANGELOG.md), not in
parallel plans or memory files.
