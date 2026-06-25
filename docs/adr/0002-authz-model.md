# ADR 0002 — Authorization: FastAPI owns authz, RLS as tier-2 defense

- Status: Accepted
- Date: 2026-06-24

## Context
Hybrid với Supabase: FastAPI truy cập Postgres của Supabase bằng SQLAlchemy với một role đặc quyền → **RLS không chặn được query của FastAPI**. RLS chỉ có hiệu lực cho truy cập trực tiếp bằng Supabase client (JWT). Cần một mô hình phân quyền rõ ràng, nhất quán, cô lập tenant (workspace).

## Decision
- **FastAPI sở hữu toàn bộ authorization.** FastAPI verify JWT do Supabase Auth phát (qua `SUPABASE_JWT_SECRET` / JWKS) → lấy `user_id`.
- Mọi truy vấn dữ liệu **bắt buộc** đi qua dependency `get_current_membership(user_id, workspace_id)` → scope theo `workspace_id` mà user là thành viên. Không có truy vấn nào bỏ qua scope.
- **RLS = phòng thủ tầng 2** cho mọi truy cập trực tiếp qua Supabase client (realtime/storage sau này).
- Test cô lập tenant (AC5) chạy ở tầng API/server, không chỉ dựa RLS.

## Consequences
- (+) Một nơi duy nhất kiểm soát authz → dễ kiểm thử, dễ suy luận.
- (+) Giải quyết gọn rủi ro "ORM vượt mặt RLS".
- (−) Mọi data layer phải kỷ luật đi qua scope; cần review để không lọt truy vấn bỏ scope.

## Alternatives
- Dựa hoàn toàn vào RLS + query bằng Supabase client: mất type-safety & sức mạnh của SQLAlchemy; logic phức tạp khó đặt trong policy SQL.
