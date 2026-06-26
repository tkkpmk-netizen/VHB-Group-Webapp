# Changelog — 26/06/2026 (phiên ~17:40–21:40)

Nhánh: `feature/26.06.2` · Toàn bộ thay đổi **chưa commit** (đang ở working tree).
Trạng thái: backend tests pass · frontend typecheck/lint/build sạch.
11 file thay đổi (+422 / −72).

---

## ✨ Tính năng

### Sub-item
- **Thêm sub-item là nhảy thẳng vào ô tên** (giống ClickUp): bấm **+** trên dòng cha sẽ tạo sub-item và mở luôn input tiêu đề để gõ tên ngay, không phải double-click tìm ô. — `table-view.tsx`
- **Load limit áp cho sub-item**: mỗi cha preload 5 sub-item, có nút **"Load more sub-items (N left)"**, mỗi lần tải thêm = mức load limit. — `table-view.tsx`

### Wrap text — áp cho TẤT CẢ các field
- Toggle **Wrap text** giờ hiện ở **mọi field** (trừ ID). — `field-config.tsx`
- Wrap hoạt động thật trên từng kiểu:
  - text/long_text/email/url, number, date, phone, created_by/time → qua `displayCls(field)` / TextCell
  - select/status/priority/country → `Dropdown` nhận prop `wrap`
  - **multi_select / relation / people** → `MultiDropdown` nhận `wrap` (tắt = 1 dòng cắt bớt, bật = xuống dòng). Trước đây luôn xuống dòng bất kể toggle.
  - rollup/formula, created_time/last_edited_time, created_by/last_edited_by → bổ sung `displayCls(field)` (trước dùng `<div>` thường, bỏ qua toggle).
- `<td>` bỏ `overflow-hidden` khi bật wrap để dòng cao không bị cắt. — `cell-editor.tsx`, `dropdown.tsx`, `table-view.tsx`

### Thêm nhiều dòng (bulk add)
- Dropdown cạnh nút **New**: nhập số (tối đa 100) → xác nhận → tạo hàng loạt.
- Backend: schema `BulkRowCreate {count: 1..100}` + endpoint `POST /databases/{id}/rows/bulk`. — `engine.py`, `schemas/engine.py`, test `test_bulk_create_rows`

---

## 💅 UI / UX

### Sửa lỗi
- **Search box làm cả trang tụt xuống**: cố định chiều cao toolbar `h-10` → mở/đóng search không xê dịch. — `view-shell.tsx`
- **Card Board hiện "Ngày tạo: [object Object]"**: date là object `{start,end}` bị `String(v)`. Thêm `cardValue()` — date format `toLocaleDateString()`, còn lại qua `toText()`. — `board-view.tsx`

### Cell editing
- 1 lần bấm = chọn ô; bấm lại ô đã chọn **hoặc** double-click ô chưa chọn = vào edit ngay.
- Ô select/relation **tự bung dropdown** khi vào edit (`autoOpen`). — `table-view.tsx`, `cell-editor.tsx`, `dropdown.tsx`

### Thanh cuộn (toàn cục)
- Scrollbar mỏng (~3px), **chỉ hiện khi đang cuộn** (fade in/out qua transition), tự ẩn sau 800ms; hover cũng hiện. Áp cho mọi vùng cuộn: table, menu, sidebar, board, popup. Không đè nội dung. — `globals.css`, `providers.tsx`

### Board layout (làm đẹp)
- **Card**: tiêu đề bán đậm + `#seq` mờ, viền mềm, hover nâng shadow, value gọn.
- **Column**: nền bo tròn, header có chip màu + count dạng pill + nút **+**, nút "New" đáy dạng dashed khi hover. — `board-view.tsx`

### Thanh dưới bảng
- Nhóm dính trái: **Load more (trái)** → **New (nút)** → **dropdown bulk-add**. — `table-view.tsx`

### Freeze column
- Vẽ lại viền cell cho cột freeze bằng `box-shadow` (border-collapse làm mất viền sticky). — `table-view.tsx`

---

## 🧪 Kiểm thử / chất lượng
- Backend: thêm `test_bulk_create_rows` (count=25 → 25 dòng, count=101 → 422).
- Frontend: typecheck + lint + build sạch sau mỗi thay đổi.

## ⚠️ Còn lại / chưa làm
- **Board chưa áp Load limit** (đang render hết card mỗi cột).
- Click card → modal chi tiết (chưa có).
- Checkbox/rating/date: vào edit vẫn cần thêm 1 click (chưa auto-open).
- Toàn bộ thay đổi **chưa commit**.
