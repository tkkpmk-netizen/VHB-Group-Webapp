# ADR 0025: Client-first runtime cache and bounded API fan-out

- Status: Accepted
- Date: 2026-07-27

## Context

The database workspace repeatedly revisits the same Spaces, folders, placements,
Fields, Layouts, and Entity pages. Refetching those resources on every mount or
window focus wastes API/hosting capacity and makes navigation feel slower.
Complete database operations can also span many server pages; issuing every page
request at once creates avoidable load spikes.

The browser has memory available for reusable runtime state, but the API must
remain the source of truth and large datasets must not remain in memory forever.
Authenticated business data should not be silently persisted to long-lived
browser storage.

## Decision

1. TanStack Query is the in-tab RAM cache. It is not persisted to
   `localStorage`, IndexedDB, or a service worker.
2. Default query data is fresh for two minutes and inactive data is collected
   after fifteen minutes.
3. Workspace structure and metadata are fresh for ten minutes and collected
   after sixty minutes. Mutations continue to invalidate the existing resource
   prefixes immediately.
4. Entity pages, searches, and dashboard widget data use shorter retention
   windows because they are larger and change more frequently.
5. Refocusing a browser window does not automatically refetch every stale
   query. Reconnect refetching remains enabled.
6. Workspace query keys are shared by the application shell and content views,
   preventing equivalent requests from occupying separate cache entries.
7. Layout renderers are split with `next/dynamic`; the browser downloads only
   the active Table, Board, List, Calendar, Gallery, or Timeline renderer and
   retains loaded modules in its normal module cache.
8. Full-database pagination is assembled in browser memory with at most four
   page requests in flight. Result order is preserved.
9. Dashboard background refresh is reduced to a two-minute interval. Direct
   mutations still invalidate affected data immediately.

## Consequences

- Navigation between recently opened Spaces, databases, and layouts reuses
  client RAM and makes fewer API calls.
- Initial database JavaScript is smaller because inactive layout renderers are
  deferred.
- Hosting/API request bursts are bounded during full-dataset operations.
- A tab that remains open can temporarily hold cached data, but inactive
  high-volume records are collected earlier than metadata and all memory is
  released when the tab closes.
- Cross-user changes may take up to the relevant stale/poll interval to appear
  unless the user explicitly refreshes or a realtime event invalidates the
  query.
