# T2 Order List rendering spike

Date: 2026-08-03  
Status: **engineering spike implemented; business golden approval pending**

## What is implemented

- A new isolated file-worker operation: `document.order_list.render`.
- A bounded, versioned JSON input snapshot with a maximum of 1,000 lines.
- Formula-injection rejection for every textual field written to the workbook.
- Deterministic XLSX package timestamps and fixed document metadata.
- Calculated monetary values materialized as Decimal values, not executable
  spreadsheet formulas.
- Merged title and party sections, Vietnamese text, repeatable table header,
  explicit A4 landscape setup, print area, page breaks, header/footer, payment
  terms, notes, and seller/buyer signature placeholders.
- Production-like PDF conversion with headless LibreOffice Calc inside the
  network-denied T0F container.
- Explicit Liberation/Noto fonts in the image for Vietnamese glyph coverage.
- Checksummed XLSX, PDF, and render-metadata artifacts.
- A 120-line regression case covering pagination, totals, formula absence,
  Vietnamese text, and artifact validation.
- Invocation through the existing T0J `file.inspect` job adapter, which stores
  worker artifacts under a workspace/job-scoped object-storage prefix.

## Reference material reviewed

The supplied Google Sheet exported successfully as
`VHB GROUP: QUY TRÌNH CÔNG VIỆC.xlsx`. It contains three workflow tabs
(`Kinh doanh`, `Mua hàng`, `Chứng từ`) and confirms the operational handoffs
for Order List/PI, signed documents, deposits, purchase orders, and export
documents. It is a process reference, not an Order List rendering template.

## Production contract used by the spike

- Input is an immutable JSON snapshot; the worker has no database credentials
  or network access.
- Output is `order-list.xlsx`, `order-list.pdf`, and
  `render-metadata.json`.
- Renderer contract is `order-list-spike-v1`.
- PDF engine is LibreOffice Calc from the pinned Debian-based file-worker image.
- Formulas and external links are unsupported. Derived values are computed by
  trusted application logic and written as values.
- Actual stamp/signature images are not synthesized. The current output reserves
  their approved positions; issued images must later come from governed assets.

## Verification evidence

- Backend: 147 tests passed; ruff and strict mypy passed.
- Frontend regression lane: 51 tests, typecheck, lint, and production build
  passed (T2 itself is a backend feasibility slice, not a user-facing builder).
- The Linux/amd64 file-worker image built successfully with LibreOffice 7.4.7.
- Two isolated 120-line executions produced the same XLSX SHA-256
  `b970e02350c577e9667b07e69fa91b500fc29f8cd110e3acd0f4f1c2340b8774`.
- The production-like PDF was valid PDF 1.6 and contained eight rendered pages.

## Evidence still required to close T2

T2 is not business-complete until the document owner supplies and approves:

1. the highest-volume current Order List template;
2. one de-identified real Ava Order List with more than 100 item lines;
3. required logos, stamps, and signature assets or exact placeholder policy;
4. approved XLSX/PDF tolerances for fonts, merges, column widths, page breaks,
   print area, header/footer, totals, and signature/stamp positioning;
5. the accepted legal-entity variants (Vihaba/M-Pacific and DP).

The supplied workflow workbook cannot substitute for these golden files.
Therefore the engineering path is demonstrated, while the owner-approved T2
exit gate remains open and must not be represented as complete.
