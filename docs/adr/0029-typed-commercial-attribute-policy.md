# ADR 0029 — Typed commercial attribute policy and explicit datasets

- Status: Accepted
- Date: 2026-07-30

## Context

Workspace roles and resource grants authorize whole Databases and platform
resources. Commercial cost, margin, customer, and legal attributes need
operation-specific protection across reads, writes, search, filter, sort,
group, aggregate, derived values, exports, reports, notifications, public
bindings, and files.

T1 compared two candidates: explicit typed commercial policies with
purpose-built reporting datasets, and one unified engine covering both typed
domain attributes and arbitrary dynamic Field UUIDs.

## Decision

Production commercial workflows use typed attributes and explicit reporting
datasets. `PolicyDecisionService` is the stable asynchronous contract. A
decision receives a workspace-bound subject, a stable attribute target, and one
operation; it returns allow/deny, a stable reason code, obligations, and policy
version.

The selected typed adapter:

- denies cross-workspace targets;
- denies new protected typed attributes until an explicit rule exists;
- distinguishes read, write, export, search/query operations, derived uses,
  preview, and download;
- returns omit, no-inference, and audit obligations on denial;
- allows a dynamic Field only when it is public within its already-authorized
  Database resource;
- rejects any attempt to mark a dynamic Field sensitive.

Query references are authorized before SQL construction. Serialization,
export, report, and projection helpers omit denied attributes. Relation search
authorizes both the relation and displayed/searchable attribute. Formula,
rollup, aggregate, dashboard, notification, and public-binding outputs inherit
the highest sensitivity of every dependency unless a future explicit,
audited declassification rule is approved.

The unified adapter remains a bounded spike only. It proved that typed and
dynamic targets can share an interface, but it is not the production factory.

## Options considered

### Unified Attribute Policy Engine now

Rejected. The dynamic engine exposes Field UUIDs through direct reads,
searches, snippets, filters, sorts, groups, aggregates, formulas, rollups,
relations, exports, dashboards, history, files, and public bindings. Supporting
protected dynamic fields safely requires every one of those paths, including
indirect inference and dependency traversal, to be policy-aware. Current
commercial requirements do not justify that blast radius or a new generic
policy language.

### Resource grants only

Rejected. A user may be allowed to access a customer or pricing resource while
being denied supplier cost, margin, a legal document download, or use of those
values in an aggregate.

### Serialize then redact

Rejected. Authorization after query construction leaks through counts,
matching, ordering, grouping, errors, timing, logs, and derived outputs.

### Frontend visibility rules

Rejected. UI visibility is useful affordance but cannot protect APIs, exports,
files, jobs, or projections.

## Consequences

- Sensitive commercial data must enter typed modules or explicit datasets, not
  arbitrary dynamic Fields.
- T3/T4 commands and query services must use the contract before database
  construction and serialization.
- Generic dynamic Database behavior remains unchanged and resource-scoped.
- The unified model can be reconsidered only after a business requirement for
  protected dynamic fields and a complete negative-access suite for every
  enforcement point.
- Policy persistence, versioned administration, and audits will extend the
  existing server-authoritative Commercial capability foundation when the
  first T3/T4 protected attributes are introduced.
