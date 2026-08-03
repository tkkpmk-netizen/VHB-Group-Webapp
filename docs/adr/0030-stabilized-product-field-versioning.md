# ADR 0030: Stabilized product field versioning

## Status

Proposed. This ADR defines the implementation boundary; the current change only
enriches the raw Database audit trail and does not create the version tables or
worker yet.

## Context

A product may be edited repeatedly while procurement and management converge on
a price. Treating every save as a new product version creates noise. A price may
also temporarily change and return to its last accepted value within the same
working session, which must not create a new version.

The raw audit trail and the business version ledger serve different purposes:

- Audit is immediate and append-only: every edit records old value, new value,
  timestamp, and actor.
- A product-field version is a stable business checkpoint created only after a
  configurable quiet period.

## Decision

### Version policy

Create a `ProductVersionPolicy` scoped by workspace and product database with:

- `trigger_field_ids`: fields whose changes may create a version, initially the
  canonical Price field.
- `snapshot_field_ids`: fields copied into the immutable version. This must
  include currency, price basis, unit, supplier/legal party, quantity tier and
  validity dates when those fields affect price meaning.
- `quiet_period_seconds`: initially 3600.
- `enabled` and policy revision metadata.

The quiet period resets only when a trigger field changes. Unrelated description
or image edits do not delay price finalization. A future policy option may reset
on any field if the business explicitly wants whole-record stability.

### Pending candidate

Maintain at most one `ProductVersionCandidate` per product and policy revision:

- `baseline_snapshot`: the latest finalized version values.
- `candidate_snapshot`: the current values of all snapshot fields.
- `first_changed_at`, `last_trigger_changed_at`, and `finalize_after`.
- `last_actor_id`, `status` (`pending`, `cancelled`, `finalized`) and a monotonic
  revision used for optimistic concurrency.

On a trigger-field edit, lock the candidate row and compare normalized values:

1. If the new trigger values equal the baseline, cancel the candidate. No
   version is created even if the value changed temporarily during the hour.
2. Otherwise upsert the candidate snapshot and set `finalize_after` to the
   trigger edit time plus one hour.
3. Emit the ordinary audit event immediately. Never wait one hour to preserve
   who changed what.

Use exact decimal values and explicit currency/unit dimensions. Never compare
prices as floating-point numbers or formatted strings.

### Finalizer

A durable worker claims due candidates with `FOR UPDATE SKIP LOCKED`. Before
publishing it checks that:

- candidate revision has not changed;
- `last_trigger_changed_at + quiet_period_seconds <= now`;
- current normalized trigger values still equal `candidate_snapshot`;
- candidate trigger values still differ from `baseline_snapshot`.

If all checks pass, insert an immutable `ProductFieldVersion` with a per-product
sequence number and a unique constraint on `(product_id, policy_id,
candidate_revision)`. Then mark the candidate finalized in the same transaction.
Retries are idempotent.

### Audit and UI

The Info bar shows two related event types in one timeline:

- Immediate edit: `Price: 12.50 USD → 12.80 USD`, exact edit time and editor.
- Stable checkpoint: `Price version v7 finalized`, effective price, stabilization
  time, originating editor, and the one-hour window.

Pending candidates may be shown as `Price change stabilizing · 42m remaining`,
but they are not versions and must not be used by quotations or approvals.
Downstream commercial records reference immutable `ProductFieldVersion.id`, not
the mutable current Entity JSONB value.

## Consequences

- Temporary edits remain fully auditable without polluting the business version
  ledger.
- Reverting to the baseline within the quiet period creates no version.
- Version publication is eventually consistent by up to one hour and requires
  the existing durable worker/job observability path.
- Price semantics must be modeled as a complete snapshot rather than a lone
  numeric field before downstream documents rely on versions.
