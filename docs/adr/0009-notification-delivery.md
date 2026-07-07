# ADR 0009: Notification Delivery

Date: 2026-07-06  
Status: Accepted

## Decision

Store notification content and read state in PostgreSQL. Cache only unread
counts in Redis with a short TTL. Notification creation writes both the
notification and a `notification.created` outbox event in the business
transaction.

The outbox publisher checks user delivery preferences and creates an
idempotent `notification.email` job. The durable worker sends through SMTP,
records `emailed_at`, and uses the existing retry/backoff policy.

## Consequences

- The inbox survives Redis loss and process restarts.
- Business writes never wait for SMTP.
- Duplicate outbox processing cannot create duplicate email jobs.
- SMTP credentials and sender-domain configuration are deployment concerns.
- Realtime push can later supplement the polling bell without changing storage.
