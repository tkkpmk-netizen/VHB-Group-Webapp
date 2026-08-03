# Attribute-policy threat model

## Assets

- supplier cost, commercial margin, price exceptions, FX/rule versions;
- customer contacts, legal identities, addresses, contracts, and attachments;
- derived KPIs, exports, reports, projections, notifications, and public data;
- policy rules, versions, decision evidence, and audit events.

## Trust boundaries

The browser is untrusted. FastAPI owns policy decisions and data access.
PostgreSQL is trusted storage but does not replace service-level attribute
policy. Jobs, exports, dashboards, notifications, files, and public runtime are
separate consumers and must not inherit an allow decision implicitly.

## Threats and controls

| Threat | Control and T1 evidence |
|---|---|
| Cross-workspace target substitution | Subject and target workspace must match; contract test denies otherwise |
| New protected attribute accidentally exposed | Typed adapter denies protected keys without an explicit rule |
| Search/filter oracle | Reference authorization occurs before query construction |
| Sort/group/count inference | Distinct operations require explicit allow; inventory covers each query expression |
| Derived-value laundering | Output inherits the highest dependency sensitivity; no implicit declassification |
| Relation-label leakage | Relation, search, and read decisions are all required |
| Export/report bulk leakage | Authorized projection omits denied attributes before artifact creation |
| Preview permission reused for download | Separate file operations and negative test |
| Cache/projection created under broader rights | Policy version and authorized source projection required before cache/read model |
| Frontend-only restriction | UI is explicitly non-authoritative; service contract is the boundary |
| Dynamic Field marked sensitive without full coverage | Production typed adapter rejects protected dynamic Fields |
| Error/conflict reveals hidden field existence | Omit/no-inference obligation; authorized deltas only |

## Residual risk and gate

The T1 code is a security prototype and contract, not authorization for a
sensitive rollout. Before T3/T4 activates the first protected dataset it must
add persisted/versioned rules, audited administration, real owning-service
enforcement, negative API tests for its operations, and policy-change
re-evaluation of projections and caches.
