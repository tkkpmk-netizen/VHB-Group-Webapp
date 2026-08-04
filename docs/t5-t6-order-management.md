# T5/T6 Order Management MVP

## Outcome

Order List rendering is now one capability inside the Order Management mini
app. The app owns typed commercial transactions used by Sales, Purchasing,
Documentation, and management; it does not mirror them into generic Database
Entities.

## Delivered T5 slice

- Sales-created Inquiry / Sourcing Request with source, customer, ownership,
  dates, notes, status, optimistic version, audit, and idempotency.
- Inquiry customer and preferred suppliers must reference Customers and
  Suppliers master Entities. Requested products normally reference Products;
  a line may explicitly use `Manual / provisional` when the product does not
  exist yet.
- Quotation aggregate with immutable versions and snapshotted customer, legal
  profile, lines, prices, totals, terms, and intake provenance.
- Quotation customer is inherited from the Inquiry, and every quotation line
  must reference a Products Entity. SKU and name snapshots are derived by the
  backend rather than accepted as free text.
- Controlled `Draft → Internally Approved → Sent → Accepted/Rejected`
  transitions. A new version supersedes an issued version instead of rewriting
  it.
- Explicit email/document evidence capture with a stable deduplication source
  key, sender/recipient/subject/time metadata, optional Asset reference, audit,
  and outbox event.
- Existing isolated Order List XLSX/PDF renderer retained as the Render tab.

## Delivered T6 slice

- Versioned Document Requirement Profiles by Vihaba/DP legal profile and
  transaction type.
- Sales Order creation only from an accepted Quotation Version whose required
  evidence is complete and whose Payment Terms currency matches.
- Sales Order customer and products are inherited from the accepted quotation;
  at least one Suppliers Entity must be selected for execution.
- Versioned Payment Terms with exactly 100% in milestones and at least one
  explicit procurement-release gate.
- Payment Receipts separate pending bank-slip evidence from confirmed credited
  funds.
- Confirmed receipts can be partially allocated across multiple Sales Orders
  and milestones without exceeding the receipt amount.
- Corrections create an append-only negative reversal linked one-to-one to the
  original allocation.
- Commercial release uses only net confirmed allocations against snapshotted
  release milestones; it never treats a promise or bank slip as credited funds.

## UI

`/order-management` contains Overview, Inquiries, Quotations, Sales Orders,
Payments, and Order List Render. `/order-list` redirects to the canonical app.
The global rail label is `Orders` and the full application title is
`Order Management`.

## Stage-gate evidence still required

The functional MVP is implemented, but the business stage gate remains open
until VHB owners approve the real 100-plus-line Order List XLSX/PDF tolerance,
exercise a real imported customer file without retyping, and approve the final
legal evidence profiles, bank-account inventory, and canonical commercial
measure reconciliation. Full mailbox synchronization remains T11 and is not
part of this implementation.
