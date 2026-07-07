# VHB Super App

Nền tảng vận hành nội bộ kết hợp database linh hoạt, documents, dashboards và
workflow theo hướng Notion + ClickUp.

Xem [Production Plan](PRODUCTION_PLAN.md) để theo dõi roadmap,
[Product Context](docs/product-context.md) để hiểu định hướng sản phẩm và
[Changelog](CHANGELOG.md) để xem lịch sử triển khai.

## Kiến trúc

```
Next.js 16 (UI) ──REST──► FastAPI ──► PostgreSQL 16
                              ├─────► MinIO / S3 object storage
                              ├─────► Google Drive Shared Drive files
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

Google sign-in requires the same Web client ID in
`backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env.local`
(`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Email notifications require the SMTP settings
documented in `backend/.env.example`; in-app notifications work without SMTP.

Database `Files & media` fields use Google Drive for file bytes and PostgreSQL
for metadata. Configure `GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE` and
`GOOGLE_DRIVE_FOLDER_ID` with a service account that has access to the target
Google Shared Drive folder.

## Yêu cầu môi trường
- Python 3.12 (uv tự quản), Node 22+, pnpm, Docker.
- Cần file `.env` cho mỗi service (xem `*.env.example`).

## Trạng thái

Foundation F1–F9, UI modernization U1–U4 và Core Functions CM1–CM7 đã hoàn
thành ở mức production baseline/MVP. Lát cắt tiếp theo là Site, Web Designer và
publishing pipeline; xem [Production Plan](PRODUCTION_PLAN.md).

## Tài liệu

- [Product context](docs/product-context.md)
- [UX guidelines](docs/ux-guidelines.md)
- [Field catalog](docs/field-catalog.md)
- [Architecture decisions](docs/adr/)
