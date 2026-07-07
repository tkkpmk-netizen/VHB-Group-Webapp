# ADR 0005: Core Functions, Transfers, and Block Documents

Status: Accepted  
Date: 2026-07-03

## Terminology

Database, Import/Export, Documents, Resource Grants, Dashboards, Identity,
Notifications, and Files & Media are Core Functions. Mini apps are composed
product experiences built on these shared functions and resources.

## Database transfers

- Source and result files live in object storage.
- Requests enqueue durable `database.import` or `database.export` jobs.
- CSV and XLSX share a normalized tabular contract.
- Imports are bounded to 100,000 rows and may create missing typed fields.
- XLSX exports use Arial, styled headers, filters, frozen headers, and safe widths.

## Block documents

- Document metadata and block JSON are workspace-scoped platform data.
- Content replacement is atomic and uses optimistic versions.
- BlockNote is loaded client-side and autosaves after a short debounce.
- Realtime collaboration remains a later extension.
