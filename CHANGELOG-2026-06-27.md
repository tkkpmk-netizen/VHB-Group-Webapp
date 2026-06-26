# Changelog — 27/06/2026 (phiên ~01:00–02:20)

Nhánh: `feature/26.06.03` (HEAD `953ec16`) · Thay đổi đang **staged, chưa commit**.
Trạng thái: frontend typecheck/lint/build ✓ · backend ruff ✓ · 15 engine tests ✓ · không còn file unmerged.

> Tiếp nối [CHANGELOG-2026-06-26.md](CHANGELOG-2026-06-26.md). Phiên này chủ yếu **khôi phục build** sau khi nhánh bị reset.

---

## 🛠️ Khôi phục build sau reset nhánh (Build Error: "Expression expected")

**Nguyên nhân:** Nhánh `feature/26.06.03` bị đưa về commit `953ec16` (cũ hơn `fed80aa` — commit chứa phần lớn việc trước đó). Khi áp lại WIP (kiểu `stash pop`):
- 4 file dính **merge conflict markers** (`<<<<<<< / ======= / >>>>>>>`) → lỗi parse.
- 8 file mà `fed80aa` đã sửa nhưng WIP không đụng tới → bị bỏ ở bản cũ `953ec16`, khiến `view-shell`/`table-view` mới gọi API không tồn tại (SettingsSidebar, ColumnMenu…).

**Đã xử lý:**
1. **Giải quyết 4 file conflict** — lấy bản "Stashed changes" (code phiên làm việc):
   `table-view.tsx`, `view-shell.tsx`, `field-config.tsx`, `test_engine.py`.
2. **Khôi phục 8 file mất từ `fed80aa`**:
   `backend/app/api/views.py`, `app/databases/[id]/page.tsx`, `layout/app-shell.tsx`,
   `table/column-menu.tsx`, `table/database-view.tsx`, `table/settings-sidebar.tsx`,
   `table/view-tools.tsx`, `table/views-bar.tsx`.
3. Xóa hết conflict markers, `git add` để thoát trạng thái unmerged.

**Kết quả:** 20 file staged (+1420 / −330). Build xanh trở lại.

---

## 🩺 Rà soát hệ thống (xác minh thực tế)
- **Calendar / Gallery / Timeline**: tab tồn tại nhưng **chưa có renderer** → đang fallback về TableView (view-shell chỉ xử lý `table`/`board`).
- **Chưa có model Invite** (ghi chú cũ "Invite model exists" đã sai) → invite/accept phải làm lại từ đầu.
- Routes hiện có: `/`, `/databases`, `/databases/[id]`, `/login`. Chưa có Docs/Tasks.
- Backend models: database, field, user, view, workspace. Backend routers: auth, databases, engine, views, workspaces.

---

## ⚠️ Việc cần làm tiếp (tóm tắt — chi tiết xem roadmap)
**Ổn định ngay:** commit phần đang dở · làm/ẩn 3 view trống · Board áp Load limit · persist activeView · auto-open checkbox/rating/date.
**Views:** Calendar/Gallery/Gantt renderer · modal chi tiết khi click row/card · per-view column width.
**Cộng tác:** Invite + accept (làm mới) · roles/permissions.
**Mở rộng:** Docs/Pages · Tasks (assignee/due/status) · seed dữ liệu VHB.
**Chất lượng:** test frontend · responsive · i18n.
