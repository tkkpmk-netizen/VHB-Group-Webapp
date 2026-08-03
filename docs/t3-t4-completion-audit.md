# T3/T4 completion audit

Date: 2026-08-03  
Scope: code, migrations, focused tests, UI routes, and accepted exit gates in
`docs/crm-order-operations-design.md`.

## Outcome

T3 and T4 are usable foundation slices, but neither satisfies its full
production exit gate yet. They should remain **MVP / partially complete**.

One material authorization issue found during this audit was fixed: Product,
Customer, and Pricing capability denials are now enforced by the direct APIs,
not only by hidden navigation. Price approval additionally requires workspace
manage permission (owner/admin).

## T3 — Migration quality

Implemented:

- immutable source rows with locators and checksums;
- versioned candidates, review status, trust tiers, conflicts, and owners;
- idempotent batch, review, conflict-resolution, and promotion commands;
- promotion receipts and a bounded Data Quality Control Center projection;
- workspace scoping and capability enforcement.

Required supplements before the T3 exit gate:

- connect uploaded assets and the T0F parser to migration batches through T0J
  jobs instead of requiring normalized rows in a synchronous request;
- implement a remap command that appends a new mapping/candidate version while
  retaining immutable raw source evidence;
- make promotion create or link the governed Product/Customer master and record
  its identifier in the receipt;
- produce per-source reconciliation evidence: input count/checksum, staged,
  excluded, duplicate, rejected, promoted, and variance;
- add priority-cohort readiness and promotion-cutoff reporting;
- add real inventoried-source fixtures and cross-workspace/remap tests.

## T4 — Governed masters and pricing

Implemented:

- Product, Supplier, Customer Account, Legal Party, Contact, FX, and price
  version tables;
- Decimal cost-plus-margin calculation and basic price approval;
- workspace-scoped Product/Customer/Pricing list and create APIs;
- first-read Product, Customer, and Pricing workspace UI;
- direct-API capability enforcement and manager-only price approval.

Required supplements before the T4 exit gate:

- Supplier, Legal Party, Contact, address, alias, and pack APIs/UI;
- explicit legal-role handling for Vihaba/M-Pacific versus DP;
- master retire, merge, dependency/reference, and hard-delete protections;
- stale/concurrent version checks for all master mutations;
- FX rate creation, activation, expiry, and immutable snapshot selection;
- oral price confirmation/rejection and override-evidence flows;
- product/customer/price create, approve, merge, and retire forms in the UI;
- typed API response contracts (the current Pricing list projection is still
  generic and labels status as `lifecycle`);
- API integration, cross-workspace, same-workspace FK, snapshot, and lifecycle
  regression tests.

## Recommendation

T2 can proceed independently as a feasibility spike. Before T5 starts, close
the T3 promotion-to-master and reconciliation gaps, then close the T4 identity,
lifecycle, FX, and approval-evidence gaps.
