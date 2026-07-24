# ADR 0011: Sites, Data Bindings, and Public Runtime

Status: Accepted  
Date: 2026-07-07

## Context

The platform needs publishable pages that can later be designed visually and
connected to dynamic database records. Published websites must not call admin
APIs or expose arbitrary database row JSON.

## Decision

Introduce a typed Design & Publishing domain:

- `Site` is a workspace-scoped resource with a global slug, publish state,
  homepage path, and CM3 `ResourceGrant` support.
- `SitePage` stores page source content as JSON and a per-site public path.
- `SiteDataBinding` stores a bounded F4 `EntityQuery`, target database, runtime
  key, optional page scope, and explicit public `field_ids`.
- Public runtime APIs live under `/public/sites` and require no user token, but
  only serve published sites/pages/bindings.
- Public binding responses execute the saved server query and then prune each
  entity to the binding's `field_ids`.

## Rationale

This keeps publishing separate from the admin database engine. Designers and
future build jobs can consume the Site/Page source model, while public visitors
receive only a restricted runtime representation.

## Consequences

- DP3 Web Designer should write project/page JSON to `SitePage.content`; it
  should not generate public HTML directly in the admin request path.
- DP5 deployment can treat generated HTML/assets as build artifacts derived
  from Site/Page source.
- Field-level public exposure is allowlist-based per binding, not inferred from
  database grants.
