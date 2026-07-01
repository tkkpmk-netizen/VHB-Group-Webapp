---
name: project-super-app-directus
description: Goal & key decisions for building a Notion+ClickUp combined webapp on top of Directus
metadata: 
  node_type: memory
  type: project
  originSessionId: 55c110d8-fd5d-4783-866f-06563ca7d9e0
---

Building a "super app" that combines Notion (docs/wiki/flexible databases) and ClickUp (task/project execution) as a single webapp (working dir `Directus_customize_v1`).

⚠️ **PIVOT 2026-06-24: build from scratch — Directus is NO LONGER the backbone, only an open-source reference.** Stack went through two pivots this session; CURRENT stack (written to `SPEC.md` + `PLAN.md` at project root):
- **Frontend**: Next.js 15 (App Router, React 19, TS) + Tailwind + shadcn/ui + TanStack Query + Zod.
- **Backend**: **Python 3.12 + FastAPI** (async), Pydantic v2, **SQLAlchemy 2.0 async (asyncpg) + Alembic**. Tooling **uv** (CONFIRMED). Frontend type-safety via **openapi-typescript** generated from FastAPI OpenAPI (CONFIRMED). Backend owns ALL data access + authorization. (Earlier intermediate plan used Next.js+Prisma with no separate backend — superseded.)
- **Temp frontend UI = DashStack Admin Dashboard UI Kit** (Figma file key `7RYemNZy6ayfFm5jkOdP5Y`; will swap official design later). Figma Dev Mode MCP confirmed reading it. Plan: pull design tokens + shell layout (sidebar/topbar/cards/tables) into Tailwind+shadcn, NOT pixel-perfect; extract per-screen via Figma MCP at build (PLAN slice A2 + R6).
- **Hybrid with Supabase**: Supabase = managed Postgres + Auth (email/pw) + Storage; FastAPI verifies Supabase JWT. Supabase deliberately kept swappable (standard Postgres, auth behind JWT, storage behind interface) to honor "avoid lock-in". Realtime = Phase sau.
- Test: pytest (backend) + Vitest + Playwright (frontend). Deploy: undecided (post-MVP; likely frontend Vercel + backend Docker/Fly/Railway + Supabase DB).
- **Dynamic schema model**: meta-schema (Workspace/WorkspaceMember/Invite/Database/Field/Row/View/RowLink) via SQLAlchemy+Alembic; user row data in JSONB keyed by field id (NOT runtime real tables). ADR `0001-dynamic-schema.md` pending.
- **Authz**: FastAPI dependency `get_current_membership` scopes every query by `workspace_id`; RLS = defense-in-depth tier 2. ADR `0002-authz-model.md` pending. (This cleanly resolved the old Prisma-vs-RLS risk.)
- **MVP scope = Notion-style database engine FIRST** (create Database/fields dynamically, Table view, filter/sort/group, relation, invite flow, RLS isolation, seed VHB from Notion via Notion MCP). AC1–AC9 in SPEC.md. Plan = 6 milestones M1–M6 in PLAN.md.
- Confirmed 2026-06-24 (Q&A): **frontend must be JS/TS** (Next.js/React) — NOT Python (browser runs JS only); Python is backend-only. **DB stays Postgres** (rejected Mongo — keeps Supabase Auth/Storage + strong relations).
- **Roadmap post-MVP** (documented in SPEC.md "Roadmap sau MVP" + PLAN.md §3b): (1) ClickUp task module, (2) **embedded design tool = BOTH a web builder (GrapesJS/Craft.js, exports HTML/deployable) AND design-mockup canvas (tldraw or self-hosted Penpot) — integrate OSS, NOT build from scratch, separate epic after MVP**, (3) block editor, (4) realtime collab, (5) file storage, (6) decide+do deploy. The original user vision was always "Figma-design-for-website + deploy real website" — the web-builder covers the deploy-real-website part.
- Everything below this line predates the pivot and refers to the abandoned Directus-backbone approach — kept for history only.

---
[HISTORICAL — Directus-backbone approach, abandoned 2026-06-24]

Decisions confirmed by user on 2026-06-17:
- **Backend**: Directus is the backbone (schema, REST/GraphQL/Realtime, Auth/RBAC, Flows, Insights, Files).
- **Front-end**: customize the Directus admin app (Vue) via a custom Module "Workspace" — NOT a separate Next/Nuxt app.
- **Tenancy**: internal tool for VHB Group first, but architect multi-tenant / SaaS-ready from the start. Recommended approach: project/DB-per-tenant.
- **v1 scope**: shared core first — flexible databases (collections) + task/project management + multiple views.

Key architecture guidance given:
- Build everything as **extensions** (module/interface/layout/panel/hook/endpoint), do NOT edit `app/src` or `api/src` core — keeps Directus upgradable.
- 4 hard custom pieces to build: (1) block doc editor (TipTap/BlockNote + Yjs for collab), (2) advanced views Gantt/Workload, (3) rollup/formula fields, (4) realtime collab.
- Big open architecture decision: runtime user-defined schema as real Directus collections (Hướng A, recommended for internal) vs EAV/generic model (Hướng B). Needs an ADR.

Decisions confirmed 2026-06-24 (during /spec session, written to `SPEC.md` at project root):
- **Schema model = Hybrid**: core collections (CRM/Orders/Sourcing/Tasks) are real Directus collections; user-created fields/DBs use generic/dynamic. Needs ADR `docs/adr/0001-hybrid-schema.md`.
- **Deploy = self-host Docker VPS**: official `directus/directus` image + Postgres 16 + Redis 7 via docker-compose, Caddy/Traefik for HTTPS. NOT building the monorepo for prod.
- **Figma = build first, document later** (post-MVP, via Figma MCP).
- **MVP scope = mirror VHB data first** (CRM/Orders/Sourcing/Tasks as real collections + seed) then dynamic UI.
- Confirmed versions: Directus API v36.0.2, Node 22, pnpm 10.27. Develop in a new `extensions/` dir; `directus-main/` is read-only reference.

Roadmap: Phase 0 env → 1 core (DB+views) → 2 ClickUp tasks → 3 Notion docs → 4 automation/insights → 5 realtime collab → 6 SaaS hardening. ~4–5 months to internal usable, ~8–10 months SaaS-ready (1–2 devs).

Related: [[user-vhb-group-business]]
