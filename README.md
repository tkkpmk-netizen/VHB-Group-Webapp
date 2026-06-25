# VHB Super App

Notion + ClickUp super app — build from scratch. Backend Python/FastAPI, frontend Next.js, Postgres via Supabase (hybrid).

Xem [SPEC.md](SPEC.md) (yêu cầu) và [PLAN.md](PLAN.md) (lộ trình build).

## Kiến trúc

```
Next.js 15 (UI) ──REST──► FastAPI (Python) ──► Supabase Postgres
       ▲ types từ OpenAPI       └─ verify JWT ──► Supabase Auth
```

- `backend/`  — FastAPI + SQLAlchemy + Alembic (uv)
- `frontend/` — Next.js + Tailwind + shadcn/ui
- `docs/adr/` — Architecture Decision Records
- `docker/`   — docker-compose, env mẫu
- `directus-main/` — CHỈ THAM KHẢO, không thuộc build

## Chạy dev

### Backend
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload   # http://localhost:8000
```

### Frontend
```bash
cd frontend
pnpm install
pnpm dev                                # http://localhost:3000
```

## Yêu cầu môi trường
- Python 3.12 (uv tự quản), Node 22+, pnpm, Docker.
- Cần file `.env` cho mỗi service (xem `*.env.example`) với keys Supabase.

## Trạng thái
MVP — đang ở Milestone M1 (foundation). Chi tiết AC1–AC9 trong [SPEC.md](SPEC.md).
