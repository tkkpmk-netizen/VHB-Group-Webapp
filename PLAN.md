# Plan: VHB Super App — MVP (Next.js + FastAPI + Supabase hybrid)

> Phase 2. Nguồn: [SPEC.md](SPEC.md). Trạng thái: **chờ duyệt**. Chia MVP thành vertical slice theo dependency; mỗi slice có checkpoint kiểm chứng ánh xạ vào AC.

## 0. Rủi ro & quyết định nền

### R1 — Authorization (đã giải gọn nhờ FastAPI) ✅→ ADR `0002`
FastAPI sở hữu toàn bộ data access. Mọi truy vấn đi qua dependency `get_current_membership(user_id, workspace_id)` → scope theo `workspace_id`. RLS = phòng thủ tầng 2. Không còn vấn đề "ORM vượt mặt RLS" như phương án Prisma cũ. **Cần viết đúng từ slice tenancy (B2) và không bao giờ bỏ qua.**

### R2 — Hiệu năng filter/sort JSONB
GIN index trên `Row.data`; paginate + filter phía server; giới hạn độ phức tạp filter ở MVP. Đo trước khi tối ưu.

### R3 — Map schema Notion → Field
Chỉ map loại field MVP hỗ trợ; loại khác (rollup/formula/status…) log-skip, không vỡ seed.

### R4 — Auth tự build trong FastAPI (không Supabase)
FastAPI tự phát JWT khi login (HS256, `APP_JWT_SECRET`) và tự verify. Cần: bảng users, hash mật khẩu (pwdlib/bcrypt), login/signup, dependency `get_current_user`. Rủi ro bảo mật nếu làm ẩu (lưu plaintext, secret yếu). Mitigation: luôn hash; secret từ env; test verify token thật/giả/hết hạn.

### R5 — Hai service (frontend + backend) chạy song song
CORS, API base URL, đồng bộ kiểu dữ liệu. Mitigation: API client tập trung ở frontend; **sinh type từ OpenAPI của FastAPI (`openapi-typescript`)** để frontend type-safe (đã chốt).

### R6 — UI tạm DashStack (Figma)
Frontend dùng DashStack Admin UI Kit làm placeholder (Figma key `7RYemNZy6ayfFm5jkOdP5Y`, MCP đọc được). Rủi ro: tốn công nếu bám sát pixel rồi lại thay. Mitigation: chỉ lấy **design tokens (màu/spacing/typography) + layout khung (sidebar/topbar/card/table)** vào Tailwind theme + shadcn; KHÔNG pixel-perfect từng màn; extract chi tiết qua Figma MCP đúng lúc dựng màn đó.

## 1. Dependency graph

```
A. Foundation
   A1 backend scaffold: FastAPI + uv + SQLAlchemy async + Alembic + ruff/mypy/pytest + /health
   A2 frontend scaffold: Next.js + Tailwind + shadcn + TanStack Query + API client + lint/test
   A3 Supabase project + env (cả 2 service) + Alembic kết nối Postgres Supabase
        │
        ▼
B. Auth + Tenancy            (cần A)
   B1 Supabase Auth email/pw (frontend) + FastAPI verify JWT (dep get_current_user)  [R4]
   B2 models Workspace+WorkspaceMember + Alembic + dep get_current_membership (scope)  [R1]
   B3 Invite flow (Invite model, mời theo email, accept → member)
        │
        ▼
C. Dynamic DB engine core    (cần B2)
   C1 models Database/Field/Row/View + Alembic + GIN index Row.data
   C2 API + service: CRUD Database; CRUD Field (text/number/select/date/checkbox) + Pydantic validate
   C3 API + service: CRUD Row (JSONB); frontend components edit/render theo field-type
        │
        ▼
D. Table view                (cần C)
   D1 Table view (rows × fields) trên frontend, gọi API
   D2 filter/sort/group resolver JSONB ở FastAPI (+ unit test nặng)
        │
        ▼
E. Relation                  (cần C, D)
   E1 field type relation + model RowLink + API link + hiển thị ở Table view
        │
        ▼
F. Seed VHB                  (cần C, E + Notion MCP)
   F1 pull Notion → map → backend/app/seed/seed_vhb.py
        │
        ▼
G. Harden & verify           (cần tất cả)
   G1 E2E Playwright + coverage backend/frontend + build + checklist AC1–AC9
```

Song song: A1 ∥ A2 (hai service độc lập tới khi nối ở A3/B1); D2 resolver viết test-first song song D1.
Tuần tự bắt buộc: A3 trước B; B2 (scope authz) trước C.

## 2. Slices + checkpoint kiểm chứng

| Slice | Mục tiêu | Verify | AC |
|---|---|---|---|
| **A1** | FastAPI chạy, `/health` 200, uv+SQLAlchemy+Alembic+ruff/mypy/pytest cấu hình | `uv run uvicorn` mở `/health`; `pytest` 1 test mẫu pass | AC1, AC9 |
| **A2** | Next.js chạy, Tailwind+shadcn, API client, lint/test; **Tailwind theme + layout khung lấy từ DashStack** (sidebar/topbar/card) qua Figma MCP | `pnpm dev` mở app-shell có sidebar+topbar theo DashStack; `pnpm test` mẫu pass | AC1, AC9 |
| **A3** | Supabase project + env 2 service; Alembic `upgrade head` tới Postgres Supabase | migration tạo bảng test; frontend gọi `/health` qua API client OK | AC1 |
| **B1** | Login/signup email-pw (Supabase) + FastAPI verify JWT | Đăng nhập lấy token; gọi API có token → 200, không token → 401 | AC1 |
| **B2** | Workspace+Member + dep scope; tạo workspace | 2 user khác workspace gọi API chỉ thấy data của mình | AC5 |
| **B3** | Invite email + accept | Mời user B; B đăng nhập thấy workspace + data đúng | AC6 |
| **C1** | models Database/Field/Row/View + migration + GIN index | migration apply; bảng + index tồn tại | AC2, AC4 |
| **C2** | CRUD Database + Field 5 loại + Pydantic validate | UI tạo Database + 5 field → lưu; reload đúng | AC2 |
| **C3** | CRUD Row JSONB + component theo field-type | Nhập/sửa/xoá row 5 loại; thêm field → row cũ giữ nguyên | AC2, AC4 |
| **D1** | Table view render rows × fields | View hiện đúng giá trị từng loại | AC3 |
| **D2** | filter/sort/group resolver JSONB | Unit test nhiều case; UI filter 1 field + sort 1 field đúng | AC3 |
| **E1** | relation field + RowLink + hiển thị | Tạo relation A→B; link row; Table view hiện liên kết | AC7 |
| **F1** | seed VHB từ Notion | Chạy seed → ≥4 Database VHB + data; field lạ log-skip | AC8 |
| **G1** | E2E + coverage + build + checklist | `test:e2e` pass; build 2 service pass; rà AC1–AC9 | tất cả |

## 3. Milestone (review theo cụm)

- **M1 — Nền tảng:** A1–A2–A3–B1. (Hai service chạy, login + verify JWT.) → review.
- **M2 — Tenancy an toàn:** B2–B3 + ADR 0002. (Workspace + invite + cô lập data.) → review.
- **M3 — Engine core:** C1–C2–C3. (Tạo DB/field/row động.) → review.
- **M4 — Xem & lọc:** D1–D2. → review.
- **M5 — Relation + seed:** E1–F1. → review.
- **M6 — Hoàn thiện MVP:** G1. → demo.

## 3b. Phase sau MVP (roadmap — ngoài M1–M6)

Không nằm trong MVP; mỗi epic sẽ có plan riêng khi tới. Thứ tự gợi ý:
1. **Task/Project module (ClickUp)** — trên cùng DB engine.
2. **Công cụ design tích hợp (cả hai, OSS):** trình dựng web (GrapesJS/Craft.js, xuất HTML + deploy) **và** design mockup (tldraw/Penpot). Đây là epic lớn nhất — sẽ tách spec/plan riêng, có khả năng cần slice nền tảng (canvas state, lưu artifact, xuất/deploy).
3. Block editor (TipTap/BlockNote) → 4. Realtime collab → 5. Storage file → 6. Chốt + thực hiện deploy.

## 4. ADR phát sinh
- `0001-dynamic-schema.md` — meta-schema + JSONB (SQLAlchemy).
- `0002-authz-model.md` — FastAPI sở hữu authz, scope workspace; RLS tầng 2.

## 5. Cần bạn quyết trước khi sang Phase 3 (Tasks)
1. **Duyệt kiến trúc 2 service** (Next.js ↔ FastAPI ↔ Supabase Postgres/Auth) trong spec.
2. **Tooling Python = uv** (đề xuất) hay Poetry?
3. **Sinh type frontend từ OpenAPI** của FastAPI (đề xuất, để type-safe) — đồng ý không?
4. Xác nhận **bắt đầu từ M1** sau khi duyệt (mình bẻ M1 thành task chi tiết ở Phase 3).
