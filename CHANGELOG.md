# Changelog — VHB Super App

Changelog gộp, mới nhất ở trên. (Trước đây tách thành `CHANGELOG-2026-06-26.md` /
`CHANGELOG-2026-06-27.md` — đã gộp vào file này.)

---

## 2026-07-03 — Database export reliability

- Sửa lỗi export XLSX/CSV với JSONB như date range, list và object lồng nhau.
- Chặn spreadsheet formula injection từ dữ liệu người dùng.
- Development API tự chạy durable worker để export không treo ở `queued`.
- Tải file qua link trực tiếp thay cho popup bất đồng bộ và bổ sung cảnh báo
  khi background processing phản hồi chậm.

---

## 2026-07-03 — Core Functions 1/2, F1 and U4

- Đổi thuật ngữ `Core Mini Apps` thành `Core Functions`.
- Core 1: CSV/XLSX import/export qua object storage và durable jobs, có UI Database.
- Core 2: Block Documents dùng BlockNote, autosave và optimistic versioning.
- Hoàn tất F1 bằng modular composition registry cho backend/frontend.
- Hoàn tất U4 bằng loading/error/retry states dùng chung cho sáu Database views.

---

## 2026-07-02 — Foundation F7/F8/F9 production hardening

Trạng thái: backend ruff/mypy/44 tests ✓ · Alembic head `c7e9a1b3d5f6` ✓ ·
Redis/session/readiness/metrics/outbox smoke tests ✓.

- F7: immutable audit trail, transactional outbox, admin audit API và worker publisher.
- F8: Redis JWT session registry, immediate logout revoke và auth rate limiting.
- F9: production secret validation, request IDs, request metrics, readiness,
  backup/restore scripts và GitHub Actions CI.
- Thêm Redis 7.4 persistent service và ADR 0004.

---

## 2026-07-02 — Foundation F5/F6: storage and durable jobs

Trạng thái: backend ruff/mypy/39 tests ✓ · Alembic head `b6d8f0a2c4e5` ✓ ·
MinIO health/smoke test ✓ · worker smoke test ✓.

- Thêm S3-compatible ObjectStorage abstraction và MinIO local.
- Thêm asset metadata, presigned upload/download, verify/list/delete APIs.
- Thêm PostgreSQL durable jobs với lease, retry backoff và idempotency.
- Worker claim bằng `FOR UPDATE SKIP LOCKED`; chạy độc lập qua
  `uv run python -m app.worker`.
- Thêm Job APIs, `system.noop` và `asset.verify` handlers.
- Thêm migration, Docker services, env config và ADR 0003.

---

## 2026-07-02 — Smooth Table incremental loading

- Khôi phục UX `Load more`, nhưng dùng server-side infinite query và append page
  vào cache thay vì thay toàn bộ bảng.
- Giữ nguyên rows đã tải và vị trí scroll trong lúc tải page tiếp theo.
- Không tải dataset search thứ hai khi search chưa được sử dụng.
- Inline cell update và delete cập nhật cache tại chỗ, tránh refetch toàn bộ pages.
- Browser QA với 75 rows: 10 → 20 rows, counter và remaining count cập nhật đúng.

---

## 2026-07-02 — ClickUp-style UI foundation

Trạng thái: frontend typecheck/lint/16 test/build ✓ · browser QA desktop ✓.

- Thay app shell bằng app rail, workspace switcher và Space/Folder/Database tree.
- Thêm UI quản trị People/Roles theo workspace và database-level Share grants.
- Thêm trang quản lý Spaces/Databases, tạo Space/Folder/Database trực tiếp.
- Table view chuyển sang F4 server pagination, hiển thị record/page count.
- Đồng bộ token màu, typography, density, focus states và database chrome.
- Tạm dừng F5/F6 cho đến khi hoàn tất và duyệt UI modernization gate.

---

## 2026-07-02 — Production foundation: authorization and queries

Trạng thái: backend ruff/mypy/34 test ✓ · Alembic head `a5c7e9f1b3d4` ✓ ·
frontend typecheck/lint/16 test/build ✓.

- F3: explicit workspace selection, workspace roles, member management và
  database-level grants.
- F4: bounded row pagination, filter, multi-sort và aggregation phía PostgreSQL.
- API client frontend lưu workspace selection và gửi `X-Workspace-ID`.
- Regenerate OpenAPI types và thêm integration tests cho tenancy, ACL và queries.

---

## 2026-07-02 — Production foundation: resource tree

Trạng thái: backend ruff/mypy/30 test ✓ · Alembic head `9a4b2c6d8e1f` ✓ ·
frontend typecheck/lint/16 test/build ✓.

### Production roadmap
- Thêm `PRODUCTION_PLAN.md` làm roadmap hiện hành; `PLAN.md` giữ vai trò lịch sử MVP.
- Chốt modular monolith + worker, tách business data khỏi platform resources.

### Workspace resources
- Thêm model/API `Space` và nested `Folder`, luôn scope theo workspace.
- `Database.folder_id` nullable: database cũ tiếp tục nằm ở workspace root.
- Signup mới tự tạo space `General`; migration data tạo `General` cho workspace hiện có.
- Chặn parent khác space, self-parent và folder cycle.
- Regenerate frontend OpenAPI types.

---

## 2026-07-01 — Database views UI/UX responsive polish

Trạng thái: frontend typecheck/lint/16 test/build ✓ · QA trực tiếp desktop + viewport 900px ✓.

### Dùng chung
- Sidebar trở thành drawer ở viewport dưới 1024px; topbar và content padding thích ứng.
- Hàng tabs/search tự xếp lại khi thiếu chỗ; toolbar Filter/Sort/Group/Customize xuống dòng
  nguyên khối, không còn cắt nhãn.
- Quick filter/sort/group popover tự giới hạn theo viewport và cuộn dọc khi nội dung dài.
- Cho phép origin mạng cục bộ trong Next dev để QA có hydration/HMR đầy đủ.

### Từng view
- **Board:** card hover rõ hơn, chiều cao cột bám viewport, empty-column có hướng dẫn.
- **List:** thuộc tính có nhãn, row spacing/readability tốt hơn, delete dùng được trên touch,
  có empty state khi filter/search không có kết quả.
- **Gallery:** grid responsive an toàn ở màn hẹp, card hierarchy/hover/delete và empty state.
- **Calendar:** header controls wrap an toàn; nút điều hướng có tooltip.
- **Timeline:** thống nhất copy tiếng Anh, nút jump-to-timeblock luôn thấy, unscheduled tray rõ nghĩa.
- **Table:** hưởng layout responsive dùng chung; giữ nguyên spreadsheet interactions hiện có.

---

## 2026-06-29 — `feature/26.06.05` → `main` (bản chính thức, commit `d995b70` + polish QA)

Trạng thái: frontend typecheck/lint/16 test/build ✓ · backend ruff/mypy/27 test ✓.

### 🛠️ Khôi phục build
- Commit trước ("Gantt View Refine" `9154d59`) đã **commit lẫn conflict markers**
  (`<<<<<<< / ======= / >>>>>>>`) vào `view-shell` / `settings-sidebar` / `board-view`
  do một lần `stash pop` hỏng → build vỡ ("Merge conflict marker encountered").
- Khôi phục chrome sạch từ commit cha `953ec16` (kiến trúc upstream nhất quán với
  `table-view`/`database-view` vẫn sạch), rồi **tích hợp lại toàn bộ tính năng** lên nền đó.

### 🗂️ Đủ 6 layout — không còn fallback Table
- **Timeline (Gantt)** — `gantt-view.tsx` + helper thuần `gantt-scale.ts`:
  header 2 dòng kiểu ClickUp (cột minor + nhóm major), **Time period** Giờ/Ngày/Tuần/
  2 tuần/Tháng/Quý/Năm, cửa sổ load quanh hôm nay + nút **More** ở mép, tray
  "chưa có ngày" (dùng chung trục, sync scroll), **kéo/kéo-giãn bar** + click/kéo set
  ngày, all-day chạy 0h→23h59, period Giờ snap 15' + block 30', nút nhảy tới timeblock,
  now-line đỏ, tô nền cuối tuần, chọn field ngày (date/created/last-edited/formula-date),
  định dạng ngày trong Customize.
- **Calendar** — `calendar-view.tsx`: **Day / 4 days / Week / Month / Year**, now-line +
  badge giờ theo **múi giờ người dùng** (GMT±X), hôm nay khoanh đỏ, **kéo-thả dời event**
  (time-grid snap 30', month/all-day đổi ngày).
- **List** — `list-view.tsx` · **Gallery** — `gallery-view.tsx`: tiêu đề sửa inline
  (CellEditor), chip thuộc tính, Filter/Sort/Group/Search dùng chung, group gập được,
  Load more (limit) + New.
- Backend: thêm `list` vào enum `ViewType` (VARCHAR → **không migration**) + regen schema.

### 📋 Table & dùng chung
- **Vertical scroll nội bộ** (chuỗi flex chiều cao AppShell→…→Table) — trang không còn dài
  ra; thead sticky.
- **Pagination** (`limit` + Load more) kể cả **tree/sub-item** (mỗi cha 5 con + "Load more
  sub-items").
- **Action bar** dưới bảng: Load more · New · **Bulk** (thêm ≤100 dòng qua `POST /rows/bulk`).
- **Calculate** chuyển vào **field menu** (ColumnMenu) + **thanh tổng in đậm** dưới bảng.
- **ColumnMenu**: Sort asc/desc · Group by · Filter by · **Wrap text** (chạy trên **mọi**
  field type kể cả created-time / sub-item / relation).
- **Cell UX**: 1 click = chọn ô; click lại ô đã chọn **hoặc** double-click = edit;
  select/relation/date **tự bung** khi edit (`autoOpen`).
- **Notion date picker**: lịch + chip start/end + Today + End date / Include time / Date format.
- **Quick View presets** + popover Filter/Sort/Group; **Layout & View-preset management**
  trong Customize (reorder/rename/duplicate/delete/set-default).
- **Search** chuyển lên hàng tab (đối diện Layout bar), giữ độ rộng.
- **ViewsBar**: bỏ nút xóa trên tab, **kéo-thả reorder** tab.

### 🔧 Backend
- `ViewUpdate.order` → reorder / set-default view; `POST /databases/{id}/rows/bulk`;
  `ViewType += list`. **27 pytest pass**.

### 🩺 QA trực tiếp trên trình duyệt + polish (đang ở working tree)
- Calendar Week/4days/Day tràn ngang, cắt cột cuối → thêm `min-w-0`.
- Calendar Year: hôm nay bị tô đỏ ở cả tháng kế (ngày tràn) → gate `inMonth`.
- Board card date `[object Object]` + List/Gallery date ISO thô → helper `displayText`
  (format `start → end`, có giờ khi cần).
- Thêm badge giờ hiện tại ở gutter Calendar.
- **Kéo-thả**: Gantt kéo bar → **verified** (đổi deadline + tự re-sort). Board/Calendar dùng
  HTML5 DnD nên công cụ tự động không kiểm được — cần kéo tay xác nhận.

### Git
- Commit `d995b70` trên `feature/26.06.05`; **force-push thay `main`** (bỏ commit hỏng
  `f33d7c3`), đặt `feature/26.06.05` làm bản chính thức.

---

## 2026-06-27 — `feature/26.06.03` (khôi phục build sau reset nhánh)

### 🛠️ Khôi phục build sau reset nhánh ("Expression expected")
**Nguyên nhân:** nhánh bị đưa về `953ec16` (cũ hơn `fed80aa`). Khi áp lại WIP (kiểu
`stash pop`): 4 file dính conflict markers → lỗi parse; 8 file `fed80aa` đã sửa nhưng WIP
không đụng tới → bị bỏ ở bản cũ, khiến `view-shell`/`table-view` gọi API không tồn tại.

**Đã xử lý:** giải quyết 4 file conflict (lấy bản làm việc): `table-view.tsx`,
`view-shell.tsx`, `field-config.tsx`, `test_engine.py`; khôi phục 8 file từ `fed80aa`
(`views.py`, `[id]/page.tsx`, `app-shell.tsx`, `column-menu.tsx`, `database-view.tsx`,
`settings-sidebar.tsx`, `view-tools.tsx`, `views-bar.tsx`); xóa markers. → 20 file, build xanh.

### 🩺 Rà soát
- Calendar/Gallery/Timeline có tab nhưng **chưa có renderer** (fallback Table). *(đã làm ở 06-29)*
- **Chưa có model Invite** (ghi chú cũ "Invite model exists" sai).
- Routes: `/`, `/databases`, `/databases/[id]`, `/login`. Backend models: database/field/user/
  view/workspace; routers: auth/databases/engine/views/workspaces.

---

## 2026-06-26 — `feature/26.06.2`

### ✨ Tính năng
- **Sub-item**: thêm sub-item nhảy thẳng vào ô tên; load limit cho sub-item (5/lần + "Load more sub-items").
- **Wrap text cho TẤT CẢ field** (trừ ID): text/number/date/phone qua `displayCls`; select/status/
  country qua `Dropdown wrap`; multi_select/relation/people qua `MultiDropdown wrap`;
  rollup/formula/created/last-edited bổ sung `displayCls`. `<td>` bỏ `overflow-hidden` khi wrap.
- **Bulk add**: dropdown cạnh New (≤100) + backend `BulkRowCreate` + `POST /rows/bulk` + test.

### 💅 UI/UX
- Sửa: search box làm tụt trang (cố định `h-10`); card Board "[object Object]" (thêm `cardValue()`).
- Cell editing: 1 click chọn / click lại hoặc double-click edit; select/relation auto-open dropdown.
- Scrollbar mỏng ~3px, chỉ hiện khi cuộn (fade, tự ẩn 800ms), mọi vùng cuộn.
- Board đẹp lại (card + column header chip/pill/+). Thanh dưới bảng: Load more · New · bulk.
- Freeze column: vẽ lại viền bằng `box-shadow`.

### 🧪 Kiểm thử
- Backend `test_bulk_create_rows` (25→25, 101→422); frontend typecheck/lint/build sạch.
