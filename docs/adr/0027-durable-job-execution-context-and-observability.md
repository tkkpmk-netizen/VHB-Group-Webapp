# ADR 0027 — Durable job execution context and observability

- Status: Accepted
- Date: 2026-07-30

## Context

Imports, exports, file verification, notification delivery, and site builds
already run through a PostgreSQL-backed queue. The original worker dispatched
those job types through a conditional chain and only persisted a terminal
string error. It did not provide durable progress, resumable checkpoints,
parent/chunk identity, cooperative cancellation, priority fairness, or a
request-to-job correlation contract.

The Commercial roadmap will add long-running migration and rendering work.
Those workloads need an execution foundation that survives worker restarts and
can be operated without logging business payloads or credentials.

## Decision

PostgreSQL remains the durable queue. Every accepted job type is registered in
one typed handler registry, and enqueue rejects types without a handler.
Handlers receive a `JobExecutionContext` with their workspace-scoped job,
database session, storage boundary, persisted checkpoint, progress writer, and
cancellation check.

Jobs persist:

- typed request, command, correlation, causation, and actor context;
- optional parent and unique chunk key;
- priority from `-10` to `10`;
- progress current/total/message and a JSON checkpoint;
- cancellation request, start, completion, and last-progress timestamps;
- a stable request hash and structured error details.

Child chunks inherit request and correlation identity from their parent. Their
causation is the parent command, while each child receives a new command ID.
The parent/chunk tuple is unique and also supplies a deterministic idempotency
key when a caller omits one.

Claiming uses `FOR UPDATE SKIP LOCKED`. Effective priority adds one point per
minute of age, capped at 20 points. This preserves useful priority ordering
while allowing the oldest lowest-priority job eventually to tie the newest
highest-priority job; existing run time and creation ordering then select the
older job.

Cancellation is cooperative. A queued job becomes terminal immediately. A
running job records the request and remains running until its handler reaches a
safe boundary; the worker then marks it cancelled. Checkpoints and progress
survive retry so a handler can resume without repeating committed chunks.

Failures store a stable code, exception kind, safe message, retryability, and
bounded details. Sensitive values discovered under credential-like payload
keys are redacted from error messages. Worker logs contain job IDs, type,
workspace, attempt, correlation metadata, stable error code, and retryability;
they never contain payloads or results.

Prometheus output exposes bounded labels for lifecycle counts, stable failure
codes, duration, queue age, progress updates, backlog, and oldest backlog age.
Payload values, IDs with unbounded cardinality, and exception prose are not
metric labels.

## Options considered

### Introduce Redis Streams or a message broker now

Rejected for this slice. PostgreSQL already provides the transaction boundary,
durability, and expected Foundation throughput. A broker would add deployment
and reconciliation paths before capacity evidence requires it.

### Hard-kill running jobs

Rejected. Interrupting arbitrary handlers can leave external storage or
partially committed business changes inconsistent. Cooperative boundaries make
the point of interruption explicit and testable.

### Strict priority ordering

Rejected. A continuous stream of urgent jobs could starve migration and
maintenance work indefinitely. Bounded aging preserves priority intent without
permanent starvation.

### Log payloads for debugging

Rejected. Commercial payloads can include customer, pricing, and credential
material. Durable checkpoints plus correlation IDs provide diagnostic evidence
without copying business data into logs or metric labels.

## Consequences

- Existing handlers share one registry and execution contract.
- A retry can inspect its last durable checkpoint and progress.
- Operators can correlate HTTP commands, child chunks, logs, and queue metrics.
- Cancellation latency depends on handler safe-point frequency.
- The PostgreSQL claim query remains the capacity boundary and must be measured
  before introducing another queue technology.
- New handlers must declare their registry entry, safe cancellation boundaries,
  checkpoint semantics, stable error codes, and metric-safe job type.
