# TODOS

## Commercial Operations

### Supplier Intelligence & Sourcing Memory

**What:** Build supplier performance history, governed scoring, and
recommendations from verified sourcing and procurement outcomes.

**Why:** Let Procurement compare suppliers using observed price, lead time,
reliability, quality, and past-order outcomes instead of reconstructing history
manually.

**Context:** The reviewed CRM/order plan deliberately captures supplier-quote
provenance, candidates, selection rationale, Manager sufficiency attestation,
commitments, and procurement outcomes without building scoring or ranking.
Revisit only after Stage 4 has operated long enough to provide representative,
verified outcome data. Start with a data-quality audit and explicit metric
definitions; do not introduce an opaque aggregate or AI-generated score.

**Effort:** M
**Priority:** P3
**Depends on:** Stage 4 adoption and a representative history of verified
supplier comparisons and procurement outcomes.

### External Trade Portal

**What:** Build a restricted portal for authorized customers or suppliers to
view and perform explicitly permitted commercial actions.

**Why:** Reduce manual quotation, order-status, document, and evidence exchanges
after the internal operating model is stable.

**Context:** The reviewed plan retains legal-party identity, actor type,
communication consent, document visibility, and immutable commercial facts as
future seams, but intentionally excludes external identity, portal APIs/UI, and
self-service. Revisit only after internal cutover. Start with a threat model and
one narrow external journey; do not expose internal APIs or generic database
capabilities by default.

**Effort:** L
**Priority:** P3
**Depends on:** Completed internal CRM/order cutover, stable attribute-policy
architecture, and named product/security owners for external access.

### Vietnamese Localization for Commercial Data

**What:** Ship a complete Vietnamese locale for the Quality Control, Product,
Customer, and Pricing workspaces.

**Why:** Let internal users who are less familiar with English complete complex
master-data, evidence, exception, and pricing work without depending on
contextual help or a colleague's translation.

**Pros:** Reduces training friction, makes validation and error recovery easier
to understand, and gives Commercial Data one reviewed terminology set rather
than ad-hoc mixed-language labels.

**Cons:** Requires business glossary ownership, translation review, text
expansion QA, screenshot/accessibility coverage, and ongoing synchronization
with the English canonical copy.

**Context:** T0–T4 keeps English as the canonical UI language while allowing
Vietnamese contextual onboarding/help. All new strings must use localization
keys, and canonical API values, status codes, permissions, audit facts, and
exported identifiers remain language-neutral. Revisit after representative
users validate the English workflows; do not translate unstable workflow copy.

**Effort:** M
**Priority:** P3
**Depends on:** Approved English interface copy, a Manager/Procurement/Sales
Admin-owned bilingual commercial glossary, and usability evidence from the
reviewed Commercial Data workspaces.

## Completed
