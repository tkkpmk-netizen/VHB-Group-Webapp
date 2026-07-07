# Field Catalog — danh mục field hoàn chỉnh của hệ thống

> Tổng hợp & hợp nhất từ Notion (property types) + ClickUp (custom fields). Đây là **danh sách khoá** mọi field type hệ thống sẽ hỗ trợ. Triển khai theo phase.

## Nguyên tắc thiết kế (quan trọng)

1. **Một số "loại field" thực ra là biến thể của một kiểu lưu trữ + cấu hình**, không cần type riêng:
   - **number** lưu số; `format` = `plain | currency | percent` (+ `precision`, `currency_code` vd VND/USD). → **Currency & Percent KHÔNG phải type riêng**, là format của number (giống Notion). *(Đúng ý "gộp number vào currency".)*
   - **status** = select có thêm **nhóm** (To-do / In-progress / Done) + dùng cho workflow/board.
   - **priority** = select preset (Urgent/High/Normal/Low).
   - **rating** = number giới hạn 1–5 hiển thị sao/emoji.
   - **url / email / phone** = text + validate định dạng.
   → Lưu chung kiểu cơ sở, khác nhau ở `options`. Ít code hơn, linh hoạt hơn.

2. **"Code field" không tồn tại như một property** ở cả Notion lẫn ClickUp. Code/đoạn mã thuộc **nội dung trang (block editor)**, không phải cột database. → để ở module doc/block (Phase sau), không đưa vào field.

3. **Computed fields (rollup, formula) phụ thuộc relation + engine tính toán** → bắt buộc làm SAU khi có relation.

## Danh mục đầy đủ (25 loại, gom nhóm)

### A. Text-like (lưu string)
| key | mô tả |
|---|---|
| `text` | 1 dòng |
| `long_text` | đoạn dài / rich text (Notion rich_text, ClickUp text) |
| `url` | link, validate |
| `email` | validate @ |
| `phone` | số điện thoại |

### B. Numeric (lưu number)
| key | mô tả |
|---|---|
| `number` | format: `plain`/`currency`/`percent`; options: `precision`, `currency_code` |

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
| `created_time` | thời điểm tạo (Row đã có `created_at`) |
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

## Views (ghi nhận, làm sau theo phase riêng)
Notion: table, board, calendar, timeline, gallery, list, form, chart, map, dashboard.
ClickUp: list, board, calendar, gantt. Mỗi view: grouping, filters (AND/OR), sorting, columns.
→ MVP làm **Table view** trước; Board/Calendar/Gantt ở phase sau.
