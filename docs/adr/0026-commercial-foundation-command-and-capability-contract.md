# ADR 0026 — Commercial command and capability contract

- Status: Accepted
- Date: 2026-07-30

## Context

Commercial Data introduces governed pricing, master-data promotion, merge,
approval, and migration decisions. Those actions cannot rely on client-side
menu hiding, prose-only HTTP errors, or optimistic requests that can be
submitted twice. The existing platform already provides workspace membership,
audit/outbox events and PostgreSQL transactions, but it has no capability
cohort persistence or durable synchronous-command receipt.

The Foundation must also remain a bounded addition to the modular monolith.
Commercial policy must not leak into the generic Database Engine or add
domain-specific switches to `AppShell`.

## Decision

Commercial Foundation owns three PostgreSQL tables:

- `commercial_workspace_policies` stores the workspace cohort, enablement and
  a monotonically increasing policy generation.
- `commercial_capability_assignments` stores explicit role or user overrides
  for a named capability. Resolution precedence is user override, role
  override, then the documented Foundation default. The environment kill
  switch is deny-only and always wins.
- `commercial_command_receipts` stores the canonical request hash and complete
  successful response for a workspace, command name and idempotency key.
  Receipts are actor-scoped so one manager cannot replay another manager's
  response by guessing or reusing a key.

Capability changes and cohort changes are synchronous Commercial commands.
One executor owns their commit/rollback boundary. It acquires a transaction
advisory lock for the idempotency tuple, checks or creates the receipt, runs the
mutation, records audit/outbox events, and commits once. A replay with the same
payload returns the stored response; reuse with a different payload returns a
typed `409` and does not run the handler.

Mutable Commercial policy rows use integer optimistic versions. A stale
expected version returns `application/problem+json` with stable
`VERSION_CONFLICT` fields, current/expected versions, changed paths, permitted
recovery actions and the request ID. User-facing prose is not a machine
contract.

The Commercial bootstrap resolves capabilities directly from PostgreSQL for
each request. No allow-side cache is introduced in Foundation, so a new denial
cannot be hidden behind stale client or Redis state. Unauthorized destinations
are removed before the response is serialized.

## Options considered

### Reuse generic resource grants

Rejected. Resource grants answer access to one concrete Database, Document,
Dashboard or Site. Commercial capabilities express permission to enter a
governed workflow spanning multiple records and projections. Overloading
resource grants would make both models ambiguous.

### JWT-embedded capability claims

Rejected. Claims would remain permissive until token expiry and violate the
deny-immediately requirement. They also make workspace cohort changes depend
on session renewal.

### Redis idempotency keys

Rejected. Redis loss or expiry could repeat a committed business mutation, and
the receipt could not be committed atomically with PostgreSQL business state.

### Client-generated conflict messages

Rejected. Parsing English detail strings is unstable and cannot safely drive
compare, refresh or retry behavior.

## Consequences

- Capability denial is enforced by FastAPI and reflected by the same bounded
  bootstrap used by the generic shell.
- Successful command replay remains deterministic across API and Redis
  restarts.
- Capability/cohort changes and their audit evidence cannot commit partially.
- PostgreSQL is intentionally consulted for each Foundation bootstrap. A
  measured read projection may be added later, but it must be deny-safe.
- New Commercial mutations must use this command boundary rather than calling
  `commit()` from nested domain services.
