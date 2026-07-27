# Field Catalog — danh mục field hoàn chỉnh của hệ thống

> Tổng hợp & hợp nhất từ Notion (property types) + ClickUp (custom fields). Đây là **danh sách khoá** mọi field type hệ thống sẽ hỗ trợ. Triển khai theo phase.

## Nguyên tắc thiết kế (quan trọng)

1. **Một số "loại field" thực ra là biến thể của một kiểu lưu trữ + cấu hình**, không cần type riêng:
   - **number** lưu số; `format` = `integer | decimal | currency | percent | unit`
     (+ `precision`, mã ISO 4217 `currency_code`, hoặc `unit_code`). → **Currency,
     Percent và đơn vị đo KHÔNG phải type riêng**, là format của number.
   - **status** = select có thêm **nhóm** (To-do / In-progress / Done) + dùng cho workflow/board.
   - **priority** = select preset (Urgent/High/Normal/Low).
   - **rating** = number giới hạn 1–5 hiển thị sao/emoji.
   - **url / email / phone** = text + validate định dạng.
   → Lưu chung kiểu cơ sở, khác nhau ở `options`. Ít code hơn, linh hoạt hơn.

2. **"Code field" không tồn tại như một property** ở cả Notion lẫn ClickUp. Code/đoạn mã thuộc **nội dung trang (block editor)**, không phải cột database. → để ở module doc/block (Phase sau), không đưa vào field.

3. **Computed fields (rollup, formula) phụ thuộc relation + engine tính toán** → bắt buộc làm SAU khi có relation.

4. **Mỗi Database có đúng một `name` field.** Đây là field bắt buộc của Entity,
   có thể đổi nhãn nhưng không thể xóa. Có thể promote một field tương thích
   thành `name` khi toàn bộ giá trị khác rỗng và độc nhất; field `name` cũ trở
   thành `text`. Tên của mọi field trong cùng Database phải độc nhất, không phân
   biệt hoa/thường và khoảng trắng đầu/cuối.

5. **Đổi loại field là thao tác preview trước, apply sau.** Các field nhập liệu
   persisted (`text`, `long_text`, `number`, `checkbox`, `date`, `url`, `email`,
   `phone`, `country`, `select`, `multi_select`, `status`, `priority`, `rating`,
   `people`, `progress`) có thể đổi qua lại:
   - giá trị tương thích được chuẩn hóa sang storage contract của loại mới;
   - giá trị không tương thích có thể được lọc riêng để sửa; `Change Anyway`
     xóa cell lỗi và đổi Name của Entity thành `WRONG FORMAT n` độc nhất để
     chúng không biến mất khỏi quy trình kiểm tra;
   - chuyển sang choice type tự tạo đầy đủ choice ổn định từ mọi giá trị khác
     nhau hiện có; không cắt ngầm theo giới hạn và không xóa dữ liệu chỉ vì số
     lượng option lớn;
   - preview nhóm các cell lỗi theo nguyên nhân cụ thể và hiển thị Entity, giá
     trị gốc cùng lý do để người dùng sửa trước khi apply;
   - `required`, field permission, alignment, wrap và metadata visibility được
     giữ lại; option đặc thù của loại cũ không bị rò sang loại mới;
   - identity, relation, files, rollup, formula và system/auto fields không cho
     đổi loại vì dữ liệu của chúng nằm ngoài cell JSONB hoặc do server tính.

   Khi đổi sang `number`, hệ thống bóc tách ký tự tiền tệ/đơn vị và dấu phân
   cách nhóm (`$4.1` → `4.1`, `170,000,000đ` → `170000000`) trước khi đánh dấu
   cell là không tương thích.

6. **Calculate phải theo loại field.** Mọi field hỗ trợ Count/Filled/Empty/
   Unique/% Filled; chỉ `number`, `rating`, `progress` hỗ trợ Sum/Average/Min/
   Max. Mã phép tính Average trên API là `avg`; client chuẩn hóa state cũ
   `average` thành `avg`.

7. **Import không tự ý đổi loại Field có sẵn.** Mỗi cột nguồn phải chọn một
   trong ba kết quả: map vào Field hiện có (type bị khóa), tạo Field mới với
   type được chọn, hoặc `Don't Import`. Select/Multi-select/Status/Priority mới
   hiển thị trước danh sách option sẽ tạo. Cột Name bắt buộc map vào Name
   canonical; UID luôn do server sinh.

8. **Created time và Last edited time là provenance của Entity.** Khi import,
   giá trị spreadsheet/ISO/epoch hợp lệ được ghi lại vào `Entity.created_at`
   và `Entity.updated_at`, không lưu thành cell JSONB và không thay thế bằng
   thời gian job import chạy. Nếu chỉ có Created time, `updated_at` khởi tạo
   bằng cùng giá trị.

## Danh mục đầy đủ (26 loại, gom nhóm)

### A. Text-like (lưu string)
| key | mô tả |
|---|---|
| `name` | tên canonical bắt buộc và độc nhất của Entity; đúng một field/Database |
| `text` | 1 dòng |
| `long_text` | đoạn dài / rich text (Notion rich_text, ClickUp text) |
| `url` | link, validate |
| `email` | validate @ |
| `phone` | số điện thoại |

### B. Numeric (lưu number)
| key | mô tả |
|---|---|
| `number` | format: `integer`/`decimal`/`currency`/`percent`/`unit`; options: `precision`, `currency_code`, `unit_code` (length/area/volume/weight/temperature/speed/time) |

### C. Boolean / Date
| key | mô tả |
|---|---|
| `checkbox` | true/false |
| `date` | ngày (+ option `include_time`; range để sau) |

### D. Choice
| key | mô tả |
|---|---|
| `select` | 1 lựa chọn — options: `choices[{id,label,color}]` |
| `multi_select` | nhiều lựa chọn (tags/labels) |
| `status` | 1 lựa chọn có **nhóm** (To-do/In-progress/Done) — workflow |
| `priority` | preset (Urgent/High/Normal/Low) |
| `rating` | thang 1–5 (sao/emoji) |

### E. People & Files
| key | mô tả | phụ thuộc |
|---|---|---|
| `people` | gán thành viên workspace (array user id) | đã có members |
| `files` | đính kèm ảnh/tệp, metadata trong PostgreSQL, bytes trên Google Drive Shared Drive | **CM7 đã có** |

### F. Relation & Computed
| key | mô tả | phụ thuộc |
|---|---|---|
| `relation` | link sang database khác (2 chiều) | — |
| `rollup` | kéo/tính từ relation (sum/avg/count/min/max…) | **cần relation** |
| `formula` | biểu thức tính toán giữa field | **cần engine biểu thức** |

### G. Progress & Location
| key | mô tả | phụ thuộc |
|---|---|---|
| `progress` | % (auto theo subtask/checklist, hoặc manual) | subtask model |
| `location` | địa chỉ + lat/lng (Google Maps) | tích hợp maps |

### H. System / Auto (không nhập tay)
| key | mô tả |
|---|---|
| `created_time` | thời điểm tạo (Entity đã có `created_at`) |
| `created_by` | người tạo |
| `last_edited_time` | sửa lần cuối (đã có `updated_at`) |
| `last_edited_by` | người sửa cuối |
| `unique_id` | ID tự tăng có prefix (vd `VHB-1234`) |

## Phân phase triển khai

**Phase E1 — làm trước (tự chứa, không phụ thuộc ngoài):**
`text`, `long_text`, `url`, `email`, `phone`, `number` (+ currency/percent format), `checkbox`, `date`, `select`, `multi_select`, `status`, `priority`, `rating`
→ Bao phủ gần hết nhu cầu CRM/Task. Đây là bộ "engine v1" đề xuất implement ngay (mở rộng từ 8 loại đang có).

**Phase E2 — cần member/relation/computed:**
`people`, `relation`, `rollup`, `formula`, `unique_id`, `created_time/by`, `last_edited_time/by`

**Phase E3 — cần hạ tầng thêm:**
`files` (CM7 Google Drive-backed), `location` (Maps), `progress` (subtask)

## Layout (ghi nhận, làm sau theo phase riêng)
Notion: table, board, calendar, timeline, gallery, list, form, chart, map, dashboard.
ClickUp: list, board, calendar, gantt. Mỗi view: grouping, filters (AND/OR), sorting, columns.
→ MVP làm **Table layout** trước; Board/Calendar/Gantt ở phase sau.
