# VHB Super App

Notion + ClickUp super app — build from scratch. Backend Python/FastAPI, frontend Next.js, Postgres.

Xem [SPEC.md](SPEC.md) (yêu cầu), [PLAN.md](PLAN.md) (MVP lịch sử) và
[PRODUCTION_PLAN.md](PRODUCTION_PLAN.md) (lộ trình production hiện hành).

## Kiến trúc

```
Next.js 16 (UI) ──REST──► FastAPI ──► PostgreSQL 16
                              ├─────► MinIO / S3 object storage
                              ├─────► PostgreSQL durable job/outbox workers
                              └─────► Redis sessions, cache and rate limits
```

- `backend/`  — FastAPI + SQLAlchemy + Alembic (uv)
- `frontend/` — Next.js + Tailwind + shadcn/ui
- `docs/adr/` — Architecture Decision Records
- `docker/`   — docker-compose, env mẫu

## Chạy dev

### Hạ tầng
```bash
cd docker
docker compose up -d db minio minio-init redis
```

### Backend
```bash
cd backend
uv sync
uv run python -m alembic upgrade head
uv run uvicorn app.main:app --reload   # http://localhost:8000
```

Ở môi trường `development`, backend tự chạy một worker nền để import/export hoạt
động ngay. Có thể chạy worker riêng để kiểm thử mô hình production:

### Worker riêng
```bash
cd backend
uv run python -m app.worker
```

### Production checks and backup

- Readiness: `GET /health/ready`
- Prometheus metrics: `GET /metrics`
- Backup: `BACKUP_DIR=./backups ./scripts/backup.sh`
- Restore PostgreSQL: `./scripts/restore-postgres.sh <dump>`

### Frontend
```bash
cd frontend
pnpm install
pnpm dev                                # http://localhost:3000
```

## Yêu cầu môi trường
- Python 3.12 (uv tự quản), Node 22+, pnpm, Docker.
- Cần file `.env` cho mỗi service (xem `*.env.example`).

## Trạng thái
MVP — đang ở Milestone M1 (foundation). Chi tiết AC1–AC9 trong [SPEC.md](SPEC.md).
