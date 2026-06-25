# Spec: VHB Super App (Notion + ClickUp — Next.js + FastAPI)

> Trạng thái: **DRAFT — chờ duyệt**. Tạo 2026-06-24 · Sửa 2026-06-24 (pivot backend sang Python/FastAPI, hybrid Supabase). Spec là nguồn sự thật chung; cập nhật spec _trước_ khi đổi code.

## Bối cảnh & các lần pivot

- Bỏ Directus làm backbone (chỉ tham khảo).
- **Backend = Python + FastAPI** (thay cho việc để logic trong Next.js). Lý do: kế hoạch AI/data, muốn backend tách rời dùng chung cho nhiều client, giảm lệ thuộc nhà cung cấp.
- **Hybrid với Supabase**: FastAPI lo business logic + dynamic schema; Supabase lo Auth + Storage (+ Realtime ở Phase sau) + cung cấp Postgres. Supabase được đặt ở vị trí **có thể thay thế** (Postgres chuẩn, Auth sau JWT, Storage sau interface).

⚠️ Gộp Notion + ClickUp từ đầu là khối lượng lớn. MVP thu hẹp về **database engine kiểu Notion** trước.

## Giả định đang dùng (sửa ngay nếu sai)

1. App là **web** (Next.js App Router) gọi **REST API của FastAPI**; không native mobile ở v1. **Frontend bắt buộc JS/TS** (trình duyệt chỉ chạy JavaScript) — Python KHÔNG dùng cho frontend; Python chỉ ở backend + AI/data.
2. **FastAPI sở hữu toàn bộ data access & authorization.** Phân quyền theo `workspace_id` nằm ở tầng FastAPI (không dựa vào RLS làm lớp chính). → giải quyết gọn rủi ro Prisma-vs-RLS trước đây.
3. **Không dùng Supabase.** Postgres chạy bằng **Docker** (local/self-host, $0). **Auth tự build trong FastAPI**: đăng ký/đăng nhập email-mật khẩu, hash mật khẩu, FastAPI tự phát + verify JWT (HS256, `APP_JWT_SECRET`). Storage + Realtime để **Phase sau**.
4. **Dynamic schema không tạo bảng Postgres runtime.** Meta-schema cố định (Workspace/Member/Invite/Database/Field/Row/View) quản lý bằng SQLAlchemy + Alembic; dữ liệu row của user lưu **JSONB** keyed theo field id.
5. Deploy **chưa chốt** (sau MVP). Ngôn ngữ dự án: tiếng Việt; code/comment/commit: tiếng Anh.

→ Xác nhận hoặc sửa 5 điểm trên trước khi sang Phase 2 chi tiết.

## Objective

Web app gộp **Notion** (database linh hoạt + doc/wiki) và **ClickUp** (task/project), backend Python tách rời, deploy được thành web thật có domain + HTTPS. Người dùng: đội VHB Group (Sale/Sourcing/Marketing/Master).

**MVP = Database engine kiểu Notion** làm nền; task module và phần còn lại xây trên cùng engine.

**Thành công (MVP):**
- Đăng nhập (Supabase Auth email/password); FastAPI verify JWT.
- **Mời thành viên vào workspace** (invite flow); thành viên thấy đúng data workspace đó.
- Tạo "Database" (bảng) mới; thêm/sửa/xoá **field động**: text, number, select (single/multi), date, checkbox, **relation**.
- Nhập row, xem qua **Table view**; filter/sort/group theo field.
- Thêm field vào Database có data → row cũ không mất.
- Seed **data VHB thật** (CRM/Orders/Sourcing/Tasks) export từ Notion (Notion MCP).

### Acceptance criteria (đo được)
- AC1: `docker compose up` (hoặc `uvicorn` + `next dev`) chạy được; đăng nhập/đăng xuất hoạt động; FastAPI `/health` OK.
- AC2: Tạo Database + ≥ 5 loại field (text/number/select/date/relation) qua UI → lưu Postgres qua FastAPI.
- AC3: Table view hiển thị rows; filter ≥ 1 field + sort ≥ 1 field đúng.
- AC4: Thêm field vào Database có data → row cũ nguyên, field mới null.
- AC5: Cô lập tenant: user workspace A không đọc được data workspace B (test qua API bằng 2 token).
- AC6: Mời 1 user qua email vào workspace; user đăng nhập thấy đúng database/data.
- AC7: Field **relation**: row Database A liên kết row Database B; Table view hiện giá trị liên kết.
- AC8: ≥ 4 Database VHB (CRM/Orders/Sourcing/Tasks) seed từ Notion với data mẫu thật.
- AC9: `pytest` (backend) + `pnpm test` (frontend) + build cả hai pass; type-check không lỗi.

## Tech Stack

| Layer | Lựa chọn | Ghi chú |
|---|---|---|
| Frontend | **Next.js 15** (App Router, React 19, TS) | UI; gọi REST API FastAPI |
| | Tailwind + **shadcn/ui** + **TanStack Query** + Zod (form) | theme khớp DashStack |
| Design source (tạm) | **DashStack Admin Dashboard UI Kit** (Figma) | file key `7RYemNZy6ayfFm5jkOdP5Y`; extract qua Figma MCP lúc build; **sẽ thay bản chính thức sau** |
| Backend | **Python 3.12 + FastAPI** (async) | REST API, sở hữu business logic + authz |
| | **Pydantic v2** | schema/validation request-response |
| ORM / migration | **SQLAlchemy 2.0 (async, asyncpg)** + **Alembic** | core meta-schema + query |
| Auth | **Tự build trong FastAPI** (email/mật khẩu + JWT) | password hash + JWT do app tự phát/verify (HS256, `APP_JWT_SECRET`) |
| Database | **PostgreSQL 16 chạy bằng Docker** (local/self-host) | KHÔNG dùng Supabase; $0, không lock-in |
| Storage | **Phase sau** (local FS / S3 sau interface) | file đính kèm chưa cần ở MVP |
| Realtime | **Phase sau** | MVP không cần |
| Tooling Python | **uv** (package/venv) | đã chốt |
| Type-safety API | sinh type FE từ **OpenAPI** của FastAPI (`openapi-typescript`) | đã chốt |
| Test | **pytest** (backend) · **Vitest + Playwright** (frontend/E2E) | |
| Deploy | **Chưa chốt** | gợi ý sau MVP: tất cả qua Docker trên 1 VPS (Postgres + backend + frontend) |
| Design | Figma (Figma MCP) | sau MVP |

### Quyết định kiến trúc dữ liệu (ADR `docs/adr/0001-dynamic-schema.md`)
Meta-schema + JSONB (Notion-style), bằng SQLAlchemy:
- `Workspace` — ranh giới tenant.
- `WorkspaceMember` — user ∈ workspace + role (owner/member).
- `Invite` — mời theo email (token, pending/accepted).
- `Database` — "bảng" do user tạo.
- `Field` — định nghĩa cột: `type`, `name`, `options`, `order`.
- `Row` — bản ghi: `data` JSONB keyed theo `field.id`.
- `View` — cấu hình hiển thị: type (table/board/calendar), filters, sorts, group, field visibility.
- `RowLink` — bảng nối cho field relation giữa Row.

> Đánh đổi: filter/sort JSONB phức tạp hơn cột thật → bù bằng GIN index + filter/paginate phía server.

### Quyết định authorization (ADR `docs/adr/0002-authz-model.md`)
- FastAPI tự phát JWT khi login và tự verify (HS256, `APP_JWT_SECRET`) → lấy `user_id`. Mọi truy vấn data **bắt buộc** qua một lớp scope theo `workspace_id` của thành viên (dependency `get_current_membership`). Không có query nào bỏ qua scope.
- Không có RLS (không dùng Supabase); authz hoàn toàn ở tầng FastAPI.

## Commands

```bash
# ===== Postgres (Docker) — thư mục docker/ =====
docker compose up -d db                  # chạy Postgres 16 (cổng 5432)
docker compose down                      # tắt

# ===== Backend (FastAPI) — thư mục backend/ =====
uv sync                                  # cài deps + tạo venv
uv run uvicorn app.main:app --reload     # chạy API dev (cổng 8000)
uv run alembic revision --autogenerate -m "<msg>"   # tạo migration
uv run alembic upgrade head              # áp migration
uv run pytest                            # test
uv run pytest --cov=app                  # coverage
uv run ruff check . && uv run ruff format .   # lint + format
uv run mypy app                          # type-check
uv run python -m app.seed.seed_vhb       # seed data VHB từ Notion

# ===== Frontend (Next.js) — thư mục frontend/ =====
pnpm install
pnpm dev                                 # next dev (cổng 3000)
pnpm build && pnpm start
pnpm lint && pnpm typecheck
pnpm test                                # vitest
pnpm test:e2e                            # playwright

# ===== Cả stack (tùy chọn) =====
docker compose up                        # FastAPI + frontend (+ Postgres local nếu không dùng Supabase cloud)
```

## Project Structure

```
Directus_customize_v1/
├── SPEC.md / PLAN.md
├── directus-main/                 # CHỈ THAM KHẢO
├── backend/                       # FastAPI
│   ├── app/
│   │   ├── main.py                # khởi tạo FastAPI app, routers, /health
│   │   ├── core/                  # config, settings (env), security (verify JWT)
│   │   ├── db/                    # engine async, session, base
│   │   ├── models/                # SQLAlchemy models (workspace, field, row, view...)
│   │   ├── schemas/               # Pydantic request/response
│   │   ├── api/                   # routers theo resource (auth, workspaces, databases, fields, rows, views)
│   │   ├── services/              # business logic (dynamic schema, filter/sort resolver)
│   │   ├── deps/                  # FastAPI dependencies (current_user, current_membership)
│   │   └── seed/seed_vhb.py       # import từ Notion
│   ├── alembic/                   # migrations
│   ├── tests/                     # pytest
│   └── pyproject.toml
├── frontend/                      # Next.js
│   ├── src/app/                   # routes (auth, workspace)
│   ├── src/components/{ui,fields,views}/
│   ├── src/lib/{api-client,supabase,validators}/
│   └── package.json
├── docker/                        # docker-compose, env mẫu
└── docs/adr/{0001-dynamic-schema.md,0002-authz-model.md}
```

## Code Style

- **Backend:** Python 3.12, FastAPI async, type hints đầy đủ; lint/format bằng **ruff**, type-check **mypy**. Pydantic v2 cho I/O. Tách `models` (SQLAlchemy) ↔ `schemas` (Pydantic). Logic vào `services/`, không nhét vào router.
- **Frontend:** TypeScript strict; gọi backend qua API client tập trung; TanStack Query cache; Zod validate form.

```python
# backend/app/services/fields.py — tạo field động + validate
from pydantic import BaseModel, Field as PField
from app.models import Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

class FieldCreate(BaseModel):
    name: str = PField(min_length=1, max_length=120)
    type: str  # text|number|select|date|checkbox|relation (validate bằng Enum)
    options: dict | None = None

async def create_field(db: AsyncSession, database_id: str, payload: FieldCreate) -> Field:
    result = await db.execute(
        select(Field).where(Field.database_id == database_id).order_by(Field.order.desc())
    )
    last = result.scalars().first()
    field = Field(database_id=database_id, order=(last.order + 1 if last else 1), **payload.model_dump())
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return field
```

## Testing Strategy

- **Backend (pytest):** unit cho services (filter/sort/group resolver trên JSONB, validators, field-type transforms) — coverage cao (≈100% cho resolver/validator). Integration: gọi API qua `httpx.AsyncClient` trên Postgres test; kiểm AC5 (cô lập tenant) bằng 2 token khác workspace.
- **Frontend (Vitest):** logic component/util thuần.
- **E2E (Playwright):** login → tạo Database → thêm field → nhập row → filter/sort.
- Vị trí: backend `backend/tests/`; frontend unit cạnh source; E2E `frontend/e2e/`.

## Boundaries

**Always:**
- Validate mọi input bằng Pydantic (backend) / Zod (frontend form).
- Mọi truy vấn data đi qua scope `workspace_id` (dependency `get_current_membership`); không query bỏ qua scope.
- Đổi schema qua Alembic migration; commit migration kèm.
- Chạy `ruff` + `mypy` + `pytest` (backend) và `lint`/`typecheck`/`test` (frontend) trước commit.
- Secret trong `.env` (đã `.gitignore`); commit `.env.example`. Đặt Supabase sau interface/config để thay được.

**Ask first:**
- Thêm dependency (Python hoặc npm).
- Đổi core meta-schema; đổi mô hình lưu dynamic data (JSONB ↔ EAV ↔ bảng thật).
- Đổi tooling (uv↔Poetry) hoặc nền tảng deploy.
- Migration có khả năng mất dữ liệu.

**Never:**
- Commit secret (`APP_JWT_SECRET`, `.env`).
- Query DB trực tiếp từ frontend (mọi data qua FastAPI).
- Lưu mật khẩu dạng plaintext; luôn hash.
- Bỏ qua scope workspace để "cho nhanh".
- Xoá/disable test đang fail mà chưa duyệt.

## Success Criteria

MVP xong khi **AC1–AC9** pass và: ADR 0001 + 0002 đã duyệt; README dựng dev (backend + frontend + Postgres Docker); demo login → tạo Database → 5 loại field + relation → filter/sort → thêm field không mất data → thấy data VHB seed.

## Quyết định đã chốt (2026-06-24)
1. Backend Python + FastAPI; **KHÔNG dùng Supabase** — Postgres chạy bằng Docker (local/self-host, $0), auth tự build trong FastAPI (email/mật khẩu + JWT). (Trước đó từng cân nhắc Supabase; bỏ vì lý do chi phí + tránh lock-in.)
2. Auth email/password + invite theo workspace (trong MVP).
3. Field relation trong MVP.
4. Seed VHB export trực tiếp từ Notion (Notion MCP).
5. Block editor + realtime collab + storage file: Phase sau.
6. **Database giữ Postgres** (không đổi Mongo) — Postgres + JSONB đủ linh hoạt + relation mạnh.
7. **Công cụ design tích hợp trong web app = CẢ HAI** (trình dựng web + design mockup), **tích hợp mã nguồn mở**, làm ở **Phase riêng sau MVP** (xem Roadmap).
8. **Tooling Python = uv**; **sinh type frontend từ OpenAPI** của FastAPI (đã chốt).
9. **UI frontend tạm thời = DashStack Admin Dashboard UI Kit** (Figma, key `7RYemNZy6ayfFm5jkOdP5Y`). Figma MCP đã xác nhận đọc được file. Dùng làm placeholder; extract từng màn hình lúc build; **thay bản chính thức sau**.

## Roadmap sau MVP (đã định hướng, ngoài phạm vi MVP hiện tại)

Theo thứ tự ưu tiên gợi ý, mỗi mục là một epic riêng sẽ có spec/plan bổ sung khi tới:
1. **Task/Project module (ClickUp)** — List/Board/Calendar, status, assignee, due date, subtask, dependency; xây trên cùng DB engine.
2. **Công cụ design tích hợp (CẢ HAI, tích hợp OSS):**
   - *Trình dựng web* (kiểu Webflow/Framer, xuất HTML, deploy thành web thật): **GrapesJS** hoặc **Craft.js**.
   - *Design mockup* (kiểu Figma/Penpot, canvas vector): **tldraw** (nhúng React) hoặc **Penpot** (self-host, tích hợp qua SSO/iframe/API).
   - Tự xây từ đầu = KHÔNG làm (quá tốn kém).
3. **Block editor / doc kiểu Notion** (TipTap/BlockNote).
4. **Realtime collab** (Yjs + WebSocket qua FastAPI).
5. **Storage file đính kèm** (local FS hoặc S3/MinIO, sau interface).
6. **Chốt & thực hiện deploy** (frontend + backend + DB).

## Open Questions (còn lại)
- Không còn blocker hạ tầng: Postgres chạy bằng Docker local, `APP_JWT_SECRET` tự sinh. Không cần tài khoản/keys bên ngoài.
- Email cho invite: MVP tạo **link mời** (copy thủ công), gửi email tự động để Phase sau (tránh phải cấu hình SMTP).
