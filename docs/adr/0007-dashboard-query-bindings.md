# ADR 0007: Dashboard Query Bindings

Date: 2026-07-06  
Status: Accepted

## Context

Dashboards must visualize live data from the platform databases without copying
business data into dashboard-specific tables or allowing unbounded client-side
aggregation.

## Decision

Persist dashboard presentation and query definitions separately:

- `Dashboard` owns metadata and CM3 resource grants and belongs to exactly one
  Space. Each Space always has one default Dashboard.
- `DashboardWidget` stores its database id, visualization type, bounded F4
  `EntityQuery`, visualization settings, and order.
- Widget data is computed on request from the source database.

F4 `EntityQuery` now supports one optional `group_by` field. Grouped aggregation is
performed in PostgreSQL and limited to 100 groups. Metric widgets consume scalar
aggregates, Bar widgets consume grouped aggregates, and Table widgets consume
bounded entities.

Reading widget data requires read permission on both the Dashboard and its
source Database. A widget's Database must also have a placement in the
Dashboard's Space. Editing widget definitions requires Dashboard write access.

## Consequences

- Dashboard results always reflect current database data.
- Opening a Space has a deterministic landing surface: its default Dashboard.
- Dashboard is no longer exposed as a separate top-level mini app.
- No duplicated analytical facts need synchronization.
- Widget queries remain inspectable and reusable by the later Site data-binding
  runtime.
- Large or high-cardinality analytical workloads will eventually need cached
  materializations rather than expanding the synchronous query limit.

## Revisit

Add date bucketing, multi-series groups, cross-database semantic metrics,
drag/resizable grid layouts, query-result caching, and scheduled snapshots when
usage data demonstrates the need.
