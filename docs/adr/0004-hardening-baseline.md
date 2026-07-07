# ADR 0004: Audit, Redis Sessions, and Production Baseline

Status: Accepted  
Date: 2026-07-02

## Decision

- Security-sensitive domain changes write an immutable `audit_events` row and a
  transactional `outbox_events` row in the same database transaction.
- PostgreSQL rejects update/delete operations on audit rows using a trigger.
- The worker publishes local outbox events; an external transport can replace
  the publisher without changing producers.
- JWTs remain short-lived credentials, while Redis stores the authoritative
  session registry. Logout revokes the `jti` immediately.
- Redis also backs fixed-window authentication rate limits and future bounded
  cache values.
- Every API response receives `X-Request-ID`; HTTP counters and cumulative
  durations are exposed in Prometheus format.
- Liveness and readiness are separate. Readiness checks PostgreSQL and Redis.
- Production startup rejects default JWT and object-storage secrets.
- PostgreSQL and MinIO backup scripts plus backend/frontend CI gates are required.

## Trade-offs

- Redis becomes required for authenticated traffic and readiness.
- In-process metrics reset on restart; use a Prometheus scraper for durable
  history.
- The initial outbox publisher marks events delivered locally. Add Kafka/NATS or
  another transport when cross-service consumers appear.
