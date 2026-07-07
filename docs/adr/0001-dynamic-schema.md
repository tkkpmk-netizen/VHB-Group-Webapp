# ADR 0001 — Dynamic schema: meta-schema + JSONB

- Status: Accepted
- Date: 2026-06-24

## Context
App cần "database kiểu Notion": người dùng tạo bảng (Database) và field động lúc runtime. Backend là FastAPI + SQLAlchemy + Alembic; Alembic cần migration tĩnh nên KHÔNG thể tạo bảng Postgres thật cho mỗi Database người dùng tạo.

## Decision
Dùng **meta-schema cố định + JSONB**:
- Bảng meta cố định, quản lý bằng SQLAlchemy + Alembic: `Workspace`,
  `WorkspaceMember`, `Space`, `Folder`, `Database`, `Field`, `Row`, `View`,
  `RowLink`.
- `Field` mô tả cột (type, name, options, order).
- Dữ liệu mỗi bản ghi nằm trong `Row.data` (JSONB) keyed theo `field.id`.
- GIN index trên `Row.data` để hỗ trợ filter.

## Consequences
- (+) Tạo Database/Field runtime không cần migration.
- (+) Linh hoạt, dễ thêm field-type.
- (−) Filter/sort/group trên JSONB phức tạp & chậm hơn cột thật → cần resolver phía server + index + phân trang.
- (−) Validation kiểu dữ liệu phải làm ở tầng ứng dụng (Pydantic + service), không dựa cột Postgres.

## Alternatives
- EAV (bảng value riêng): nhiều join, phức tạp hơn JSONB.
- Tạo bảng Postgres thật runtime: vỡ mô hình migration của Alembic; khó multi-tenant.
