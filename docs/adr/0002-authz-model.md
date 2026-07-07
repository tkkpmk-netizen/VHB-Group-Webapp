# ADR 0002 — FastAPI-owned workspace and resource authorization

- Status: Accepted
- Date: 2026-06-24
- Updated: 2026-07-06

## Context

The application uses app-issued JWT sessions and PostgreSQL through SQLAlchemy.
FastAPI is the only data-access boundary. Tenant isolation and resource
permissions therefore must be enforced consistently in the API rather than
delegated to a frontend or an external database client.

## Decision

- FastAPI authenticates email/password or linked identity providers and issues
  JWTs backed by the Redis session registry.
- Every tenant request resolves an explicit workspace membership. Accounts with
  multiple workspaces must send `X-Workspace-ID`.
- Workspace roles provide default `read`, `write`, and `manage` actions.
- `ResourceGrant` can override that default for a specific Database, Document,
  Dashboard, or later resource type.
- Owner/admin memberships retain full workspace access.
- Every resource lookup validates workspace ownership; no frontend check is a
  security boundary.

## Consequences

- Authorization behavior is centralized and integration-testable.
- New resource domains must register with the generic policy and clean up
  polymorphic grants when resources are deleted.
- Direct database access from the frontend is prohibited.

## Related decisions

- [ADR 0006](0006-generic-resource-authorization.md)
- [ADR 0008](0008-google-identity-linking.md)
