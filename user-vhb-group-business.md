---
name: user-vhb-group-business
description: "User runs VHB Group, a B2B trading/export business; current tooling is Notion + ClickUp"
metadata: 
  node_type: memory
  type: user
  originSessionId: 55c110d8-fd5d-4783-866f-06563ca7d9e0
---

User operates **VHB Group** (B2B trading/export, food sector — M-Pacific brand, exhibitions like Sial Shanghai/Thaifex, partners incl. Unilever/P&G). Communicates in Vietnamese.

Current tooling (the system the super-app will eventually replace):
- **Notion** = mature system-of-record. "VHB Group Business Hub" with front-end Workspaces (Sale, Sourcing, Marketing, Master) over Backends: CRM (Customer Relation Management — rich schema: company, nation, source, orders rollup, revenue), Order Management, Inquiry, Sourcing/Suppliers databases, plus Sync Blocks, automations, an "Ultimate Tasks 3.0 / Second Brain" task layer.
- **ClickUp** = mostly the out-of-the-box GTD template ("Personal Dashboard" space, Getting Things Done folder), only demo tasks — not yet real work.

Implication: Notion is data-rich, ClickUp is near-empty. The super-app should mirror the VHB Hub data model (CRM, Orders, Sourcing, Tasks) for realistic dev data.

Related: [[project-super-app-directus]]
