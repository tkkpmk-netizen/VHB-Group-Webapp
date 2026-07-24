# Changelog — VHB Super App

Changelog gộp, mới nhất ở trên. (Trước đây tách thành `CHANGELOG-2026-06-26.md` /
`CHANGELOG-2026-06-27.md` — đã gộp vào file này.)

---

## 2026-07-23 — Safe field-type conversion and reliable calculations

- Calculate now uses the API's canonical `avg` operation, normalizes legacy
  `average` layout state, and only offers numeric calculations for Number,
  Rating and Progress fields. Invalid persisted calculations are ignored by
  the client and rejected with a bounded 422 response by the API instead of
  reaching PostgreSQL as an invalid aggregate.
- Edit Field now includes a custom Field type dropdown for persisted editable
  types. Choosing a new type opens a preview with mapped, cleared and empty cell
  counts before any mutation occurs.
- Applying a conversion maps compatible values across every Entity, removes
  incompatible cell keys, preserves generic field governance settings, and
  automatically creates deterministic choices when converting existing values
  to Select, Multi-select, Status or Priority.
- Built-in identity, Relation, Files and computed/system field types remain
  protected from destructive conversion.

---

## 2026-07-23 — Single-parent Sub-items and compact Table footer

- `Parent item` now uses a searchable single-select. The backend enforces one
  parent per Entity and re-parenting automatically removes the previous link,
  including changes made through the owner-side `Sub-item` field.
- The Add Sub-item control stays visually quiet during row hover and appears
  only when its own hit area is hovered or keyboard-focused.
- View controls now have equal 4 px breathing space above and below.
- Removed the footer divider above Load more/New. Calculations and the record
  count now share one bordered box that fills the remaining footer width.

---

## 2026-07-23 — Stable Sub-item trees across paginated Entity data

- Table now de-duplicates Entity pages by ID before rendering, so optimistic
  inserts and overlapping page responses cannot produce duplicate React row
  keys or duplicated records.
- Added a workspace-scoped Sub-item tree query that loads connected parents
  and children outside the currently fetched page; expanded hierarchies remain
  complete after reload.
- Sub-item creation now supplies the required Entity name, updates the page
  total immediately and keeps parent/child relation data visible without
  waiting for another page fetch.
- Recursive tree rendering is cycle-safe and renders each Entity at most once.
  Entity deletion also clears all cached Sub-item-tree copies immediately, so
  deleted children cannot remain as stale rows.

---

## 2026-07-23 — Database layout density, compact controls and linked Entity Docs

- Chuẩn hóa spacing/typography trên toàn bộ Database UI: Layout bar và View
  controls dùng inset 18 px, label 11–12 px; View controls 28 px không scroll
  dọc và cách work area bằng khoảng thở 4 px thay cho divider.
- `Default View` trở thành dropdown button 24 px thật; menu, settings và field
  forms dùng chung nhịp 28–32 px và typography cô đọng.
- List dùng row 30 px/chữ 11 px; Board card/column thu gọn và kéo đầy work
  area; Gallery đồng bộ chữ 11 px, card 220 px và gap 8 px.
- Timeline đưa date field/time scale thành value-only dropdown cạnh View
  Preset, đồng thời cho phép đóng/mở Unscheduled. Calendar dùng compact period
  controls, căn lại All day và chia lane cho các event trùng thời gian.
- Đổi `Edit Properties` thành `Edit Field`, bổ sung icon Field trong danh sách
  và heading chỉnh sửa.
- Document tạo từ Entity được truy vấn theo `source_entity_id`, hiện lại bên
  dưới Fields khi mở Entity và chỉnh sửa inline; setting
  `entity_doc_visible` lưu mặc định ẩn/hiện metadata theo từng Field.

---

## 2026-07-23 — Dense Database chrome and outline selection

- Chuẩn hóa Global Topbar 32 px; Database Context, Layout và View controls đều 28 px. Giảm typography/icon tương ứng để giữ khả năng đọc ở mật độ ClickUp.
- Table chuyển sang row 30 px, header 32 px, chữ 11 px và footer 26 px; cột freeze dùng divider đậm hơn.
- Cell selection dùng outline riêng; row selection chỉ dùng viền bao quanh. Click cell xóa row selection, tick checkbox xóa cell range nên hai mode không thể cùng tồn tại.
- Frozen boundary dùng inset divider nằm trong sticky cell và layering riêng, nên không mất line khi kéo ngang; hover/selection của vùng cuộn luôn nằm dưới frozen pane.
- Checkbox hỗ trợ Cmd/Ctrl-click để cộng/trừ từng row vào selection hiện có; Shift-click vẫn chọn một dải liên tiếp.
- Cell range và các row được chọn liên tiếp dùng một primary border liên tục bao quanh cả vùng; các cell/row ở giữa không còn vẽ viền từng ô.
- Row content được căn giữa theo trục dọc; outline chọn row chuyển thành overlay tuyệt đối nên không làm thay đổi chiều cao hay đẩy grid. Text editor chỉ giữ outline ở cell ngoài, bỏ focus highlight lồng bên trong.

---

## 2026-07-23 — Sub-item hierarchy and full-row selection

- Sub-item mới được đưa ngay vào page dữ liệu đang mở và parent tự mở lần đầu, tránh việc child biến mất khi thứ tự server đưa nó ra ngoài trang hiện tại.
- Tree controls được đặt cạnh Name: parent có child luôn có disclosure; nút tạo sub-item chỉ hiện khi hover Name.
- Thêm gutter kéo-thả 28 px bên trái ngoài grid dữ liệu, giữ checkbox trong cột chọn riêng; chọn cell hoặc row highlight đồng nhất cả hàng.

---

## 2026-07-23 — Table row density and selection alignment

- Chuẩn hóa table header 32 px và entity row 30 px để work area ở zoom 100% hiển thị khoảng 25 dòng dữ liệu.
- Checkbox chọn row/header được căn chính giữa cùng một cột; bỏ drag handle khỏi cột chọn để bảng yên tĩnh hơn.

---

## 2026-07-23 — Compact view toolbar and active Layout tabs

- Nén toolbar thao tác View thành các button 28 px có border, giảm khoảng trống phía trên bảng; Filter, Sort, Group, Customize và View Preset đang kích hoạt dùng primary tint rõ ràng.
- Layout tab chỉ thể hiện trạng thái active theo phong cách ClickUp (primary underline/tint); bỏ nút cài đặt/ba chấm xuất hiện khi hover. Menu Layout vẫn mở bằng chuột phải hoặc thao tác Rename & icon.

---

## 2026-07-23 — Table grid, freeze and hover polish

- Thêm border dọc giữa mọi cột, mặc định căn trái và fallback icon theo loại Field.
- Frozen boundary có divider đậm/shadow nhẹ, row rule xuyên sticky cells; thêm row hover nhẹ.

---

## 2026-07-23 — Compact table footer

- Gộp Load more, New, calculation và record count vào một footer 32 px; Load more/New nằm ngoài cùng bên trái để tăng work area.

---

## 2026-07-23 — In-Space pinned layouts

- Pinned Layout là tab nội bộ của Space: chọn tab render DatabaseView của placement ngay trong work area, không điều hướng khỏi Space.
- Bỏ header General/icon/description trùng lặp khỏi Space Overview.

---

## 2026-07-23 — Tree item context menus

- Right-click Space, Folder, placement Database hoặc canonical Database mở đúng menu thao tác của item tại con trỏ; menu ba chấm dùng cùng surface.
- Thu icon hover Plus/More về 12 px, hit target 20 px để đồng bộ với tree icons.

---

## 2026-07-23 — Canonical All Database inventory

- All Database bỏ cột Space/hierarchy, mỗi Database chỉ còn một canonical row.
- Gom permission và row menu vào action cluster bên phải, căn giữa ổn định và reveal theo hover/focus.

---

## 2026-07-23 — Top-aligned Space context and Layout right-click

- Tách Context Sidebar thành cột độc lập từ mép trên; global topbar chỉ thuộc work area.
- Mở Database qua Space chỉ giữ breadcrumb, bỏ database title/description trùng lặp.
- Right-click Layout mở menu Rename & icon, Duplicate, Pin/Unpin to Space và Delete tại con trỏ.

---

## 2026-07-23 — Context tree alignment

- Chuẩn hóa indent tree theo một nested branch step, giúp chevron, đường dọc,
  folder và database thẳng hàng ở mọi cấp. Thanh `Spaces` được đưa sát đầu
  context bar với nhóm action căn giữa đồng nhất.

---

## 2026-07-23 — Database lifecycle, placement Favorites và app context menu

- All Database hỗ trợ nhân đôi schema/Layout rỗng, xóa Database có kiểm soát quyền và mở Database permission management; màu icon canonical được hiển thị đúng trong inventory.
- Favorites chuyển sang Space placement (Space-specific view), không còn trỏ Database gốc; pinned Layout chỉ hiển thị tên view, nguồn Database nằm ở hover.
- Header Context Sidebar bo góc/align icon gọn hơn; drag database/layout giữ source và có native ghost sát con trỏ.
- Chặn menu mặc định trình duyệt trong app, thay bằng fallback application context menu; item database/placement vẫn có menu thao tác riêng.
- Ghi nhận tại [ADR 0023](docs/adr/0023-database-lifecycle-and-placement-favorites.md).

---

## 2026-07-23 — Field governance, compact field editing và Space layout pins

- Thêm Required và quyền sửa dữ liệu theo từng Field (`All editors` / `Admins & owners`), validate ở create/update/bulk create và spreadsheet import; import bắt buộc map các Field required.
- Edit Field nay có đủ Sort, Group, Filter, Wrap, Calculate, Freeze, Insert trái/phải và Delete; Insert luôn mở form nhập tên + type trước khi tạo Field.
- Đổi `Default Layout` thành `Default View`; Layout có thể đổi tên/icon, nhân đôi, xóa và Layout của placement có thể pin cạnh Overview trong Space.
- Color picker dùng palette có nhãn/portal; date popover định vị trước lần render đầu; bổ sung cell alignment Auto/Left/Center/Right; bỏ nhãn chữ loại Field thừa.
- Thu gọn context sidebar, giảm icon hierarchy, tăng phân cấp typography; ghi nhận tại [ADR 0022](docs/adr/0022-field-governance-and-space-layout-pins.md).

---

## 2026-07-23 — Searchable fields, Favorites và Entity page kiểu Notion

- Relation, Country, Select và Multi-select dùng popup có search; Country lấy
  từ catalog đầy đủ 250 quốc gia/vùng lãnh thổ thay danh sách rút gọn.
- ID mặc định của Entity là số thứ tự đơn giản (`1`, `2`, …); chỉ thêm prefix
  khi Field được cấu hình prefix. Create, bulk create và import dùng cùng quy
  tắc, dữ liệu cũ được backfill bằng migration.
- Thêm Favorite Database theo từng user/workspace và ghim thành section riêng
  trên Context Sidebar; Favorite không tạo hoặc di chuyển Space placement.
- IconPicker hỗ trợ chọn màu semantic và persist màu cho Database, Folder,
  Field, Layout, Document; Space tiếp tục dùng thuộc tính màu hiện có.
- Layout tabs nằm bên trái; Search, Automation, Share, Import/Export nằm bên
  phải. Search là popover cố định, Customize bị giới hạn dưới Layout bar.
- Khi kéo, item nguồn luôn nằm nguyên và được highlight; bỏ ghost/preview tách
  khỏi thanh công cụ. Reorder/move vẫn cập nhật theo vị trí con trỏ thời gian
  thực với motion ease-in/ease-out.
- Hoàn thiện Space `Overview` như Dashboard mặc định có thể chỉnh sửa. Nút mở
  Entity nằm ở góc phải Name cell; Document tạo từ Entity có giao diện page kiểu
  Notion, metadata sửa được và ẩn/hiện từng thuộc tính.
- Thêm [ADR 0021](docs/adr/0021-searchable-fields-favorites-and-entity-pages.md)
  và cập nhật UX Guidelines, UI System, Product Context, Design System.
- Baseline: Alembic `e6b8d0f2a4c6 (head)`; backend ruff/mypy và 86 tests;
  frontend 20 tests, typecheck, lint và production build đều đạt.

---

## 2026-07-23 — Placement Layout độc lập, FTP explorer và live drag

- Thêm migration `d5a7c9e1f3b5`: mỗi placement clone bộ Layout mặc định từ
  Database gốc đúng một lần; thêm/xóa/đổi tên/cấu hình Layout sau đó chỉ tác
  động placement đang mở, không ảnh hưởng Space khác hay canonical Database.
- Database link trong cây và Space Management mang `placement_id`; breadcrumb
  chỉ hiện đúng Space/Folder của placement đang mở.
- Thay card Space Management bằng cây FTP dạng hàng dày thông tin với cột Name,
  Type, Location; giữ Database bar bên phải và hỗ trợ folder lồng nhau.
- Kéo-thả cập nhật ngay khi con trỏ đi vào vị trí đích; item nguồn giữ nguyên
  trong cây/thanh công cụ và được highlight, native ghost bị ẩn; thả chuột chỉ
  kết thúc thao tác.
- Chuẩn hóa motion ease-in/ease-out và z-index scale; IconPicker ở layer 160,
  luôn nổi trên dialog/dropdown/menu.
- Thêm [ADR 0020](docs/adr/0020-placement-layouts-ftp-and-live-drag.md), cập
  nhật UI System và Product Context.

---

## 2026-07-17 — Font Awesome 5 Solid, Database hierarchy và Entity popup

- Chuẩn hóa toàn bộ icon UI sang 1,002 SVG Font Awesome Free 5.15.3 Solid do
  chủ dự án cung cấp; bỏ dependency Lucide, giữ attribution/license gốc và thêm
  `FaIcon`, semantic color token cùng searchable `IconPicker` dùng chung.
- Persist icon cho Space, Folder, Database, Layout, Field và Document; thêm
  migration `c4f6a8b0d2e4`, backfill icon có nghĩa cho dữ liệu hiện hữu và tăng
  giới hạn tên icon lên 64 ký tự.
- Database header liệt kê đúng mọi placement path `Space / Folder / Database`,
  fallback về `All Database`; không còn breadcrumb giả một địa chỉ duy nhất.
- Đưa Search, Automation, Share, Import/Export vào Layout bar với popover Search
  cố định 320px, không làm tabs thay đổi chiều rộng. Cụm này được chuyển sang
  mép phải trong lượt hoàn thiện ngày 23/07.
- Thêm Entity popup dùng lại `CellEditor` để sửa cell/name từ mọi Layout. Nút
  `Create Doc` tạo Document gắn `source_entity_id` đã kiểm tra workspace và mở
  BlockNote trong popup window lồng phía trên.
- Chuyển workspace selector thành avatar user ở bên phải topbar, ngay trước Log
  out; dropdown hiển thị identity, workspace và role.
- Cập nhật [UI System](docs/ui-system.md),
  [ClickUp Runtime Analysis](docs/clickup-ui-runtime-analysis.md) và
  [ADR 0019](docs/adr/0019-fa5-icons-and-entity-documents.md).
- Baseline: Alembic `c4f6a8b0d2e4 (head)`; backend ruff, mypy và 85/85 tests;
  frontend 20/20 tests, typecheck, lint và production build đều đạt.

---

## 2026-07-17 — Space Database placements và Space-owned Dashboard

- Bỏ quan hệ độc quyền `Database.folder_id`; Database trở lại inventory cấp
  workspace và có thể xuất hiện đồng thời trong nhiều Space.
- Thêm `SpaceDatabasePlacement` lưu `space_id`, `database_id`, `folder_id`,
  `layout_id`, thứ tự và settings hiển thị riêng của từng Space. Migration
  backfill các vị trí cũ và giữ `Database.order` làm thứ tự trong All Database.
- Dashboard thuộc trực tiếp Space, mỗi Space luôn có một Dashboard mặc định;
  Space mới và workspace mới tự tạo `Overview`. Widget chỉ bind Database đã
  được đặt trong cùng Space.
- Bỏ Dashboard khỏi Global Navigation. Click Space ở Context Sidebar mở
  Dashboard mặc định; click Folder chỉ đóng/mở cây và không đổi work area.
- Thêm `Space Management` dưới `All Database`, file-like Space/Folder work area,
  Database bar bên phải, kéo-thả tạo/move placement, cùng các action tương
  đương cho touch/keyboard.
- Hoàn thiện lượt UI theo phân tích runtime ClickUp: topbar 40px, context
  sidebar 256px, tree row 30px, work area `#F9F9F9`, panel radius 12px; nén
  All Database và Space Management, thêm đường dẫn folder lồng nhau, hover
  action ổn định và dialog có scrim/close button rõ ràng. Ghi số đo, pattern,
  khác biệt sản phẩm và tiêu chí nghiệm thu tại
  [ClickUp UI Runtime Analysis](docs/clickup-ui-runtime-analysis.md).
- Ghi quyết định kiến trúc tại
  [ADR 0018](docs/adr/0018-space-database-placements-and-dashboards.md).
- Baseline sau thay đổi: Alembic `b3e5f7a9c1d3 (head)`; backend ruff, mypy và
  85/85 tests; frontend 20/20 tests, typecheck, lint và production build đều đạt.

---

## 2026-07-08 — Đổi thuật ngữ Entity/Layout, thêm DataSource và View Preset

- Đổi tên toàn bộ (model, bảng Postgres, API route, OpenAPI schema, frontend
  type, UI copy): `Row`→`Entity`, `RowLink`→`EntityLink` (4 route
  `/databases/{id}/rows`→`/entities`, `/rows/{id}`→`/entities/{id}`);
  `View`→`Layout`, `ViewType`→`LayoutType` (`/databases/{id}/views`→`/layouts`,
  `/views/{id}`→`/layouts/{id}`). 4 migration Alembic nối tiếp, chỉ đổi tên
  bảng/cột (không rewrite dữ liệu).
- Thêm **DataSource**: một Database có thể chứa nhiều nguồn dữ liệu (thủ công
  hoặc từ import); mỗi Entity thuộc đúng 1 DataSource
  (`data_source_id` NOT NULL, FK RESTRICT). Mỗi database luôn có 1 nguồn
  "Primary" mặc định. Import CSV/XLSX giờ tạo (hoặc dùng lại) 1 DataSource và
  gắn vào mọi entity được tạo ra. `data_source_id` lọc được như filter/sort/
  group thông thường (pseudo-field trong entity query engine). API mới:
  `GET/POST /databases/{id}/data-sources`, `PATCH/DELETE /data-sources/{id}`.
- Thêm **View Preset** như một entity backend thật (trước đây chỉ là blob
  JSON phía frontend trong `Layout.config`): bảng `view_presets`,
  `Layout.active_view_preset_id` đánh dấu preset đang áp dụng. API mới:
  `GET/POST /layouts/{id}/view-presets`, `PATCH/DELETE /view-presets/{id}`;
  áp dụng preset qua `PATCH /layouts/{id}` với `active_view_preset_id`.
  Migration backfill preset cũ từ `config.presets`/`config.activePreset`.
- Frontend: regenerate `schema.ts`, đổi toàn bộ type/route/query-key liên
  quan, thêm bộ chọn Data Source trên toolbar mỗi Layout, ô đặt tên Data
  Source khi import, dịch nốt vài chữ tiếng Việt còn sót trong Settings
  sidebar sang tiếng Anh.
- Ghi lại toàn bộ quyết định ở
  [ADR 0017](docs/adr/0017-entity-layout-datasource-viewpreset.md).
- Ghi nhận kế hoạch (chưa triển khai): Form Layout và Dashboard-as-a-Layout,
  xem `PRODUCTION_PLAN.md`.

---

## 2026-07-07 — Hardening sau audit toàn hệ thống

- Relation chỉ nhận target row thuộc đúng target database của field (chặn
  cross-workspace link/rollup leak); rollup fetch cũng scope theo target database.
- Thêm unique constraint `(database_id, seq)` trên `rows` + advisory lock khi
  cấp `seq` (`next_row_seq` dùng chung cho engine API và spreadsheet import) —
  hết race sinh `unique_id` trùng. Migration `6b8d0f2a4c3e`.
- Rate limit theo IP cho toàn bộ `/public/*` (mặc định 120 req/phút,
  `PUBLIC_RATE_LIMIT_PER_MINUTE`).
- `PATCH /fields/{id}` không cho ghi đè các option cấu trúc của relation
  (`target_database_id`, `mirror`, `owner_field_id`, `paired_field_id`, …).
- Public render thêm header `Content-Security-Policy` (object-src/base-uri)
  và `X-Content-Type-Options: nosniff`.
- Frontend `apiFetch` đọc `detail` từ body lỗi FastAPI thay vì chỉ báo status code.
- Dời file compose của Penpot ra `docker/penpot/` để `docker compose` trong
  `docker/` trỏ đúng stack của project.

---

## 2026-07-07 — DP7 Realtime collaboration MVP

- Thêm WebSocket endpoint `/collaboration/ws/{resource_type}/{resource_id}`.
- Hỗ trợ realtime room cho `document` và `site_page`.
- Xác thực bằng JWT token, active session Redis và workspace-scoped resource
  authorization.
- Thêm presence snapshot/join/leave và event broadcast cho cursor, selection,
  document content change, design change.
- Thêm frontend hook `useCollaboration`.
- Document editor hiển thị online collaborators và broadcast content change,
  vẫn giữ autosave optimistic version làm source of truth.
- Web Designer hiển thị online collaborators và broadcast design save/reset.

---

## 2026-07-07 — DP6 Domains, environments and rollback

- Thêm environment `production` và `preview` cho `SiteDeployment`.
- Thêm active deployment theo site/environment; build thành công tự activate
  deployment mới trong environment đó.
- Thêm rollback/promote endpoint `POST /site-deployments/{deployment_id}/promote`.
- Thêm `SiteDomain` để quản lý hostname, environment, verified và primary.
- Thêm public domain render endpoint `/public/domains/{hostname}/render[/path]`.
- Site Manager có chọn environment khi build, active badge, rollback/promote,
  domain create, mark verified, make primary và remove.

---

## 2026-07-07 — DP5 Build and deployment pipeline

- Thêm `SiteDeployment` để quản lý version, status, job build, asset artifact,
  manifest và lỗi build.
- Thêm migration `4f6a8c0d2e1b_site_deployments`.
- Thêm endpoint `POST /sites/{site_id}/deployments` để queue durable job
  `site.build`.
- Worker build các page đã publish thành HTML artifact và lưu vào object
  storage qua `Asset`.
- Thêm public render endpoint `/public/sites/{slug}/render[/path]`, chỉ phục vụ
  artifact ready của site đã publish.
- Artifact HTML tự hydrate các marker `data-vhb-binding` bằng DP2 public binding
  API.
- Site Manager có panel Deploy: Build & deploy, polling status và link preview.

---

## 2026-07-07 — DP4 Design import pipeline

- Thêm endpoint `POST /site-pages/{page_id}/import-design` để import artifact
  thiết kế vào page đang chọn.
- Hỗ trợ HTML/CSS export từ Figma/Penpot/static tools và GrapesJS project JSON.
- Chuẩn hóa mọi import về `SitePage.content.type = "grapesjs"` để Web Designer
  mở và chỉnh tiếp được.
- Thêm sanitizer backend cho HTML/CSS import nhằm loại script, event handler,
  `javascript:` URL và CSS nguy hiểm.
- Thêm UI import trong Site Manager: upload `.html`, `.css`, `.json` hoặc paste
  source trực tiếp.

---

## 2026-07-07 — DP3 Web Designer

- Thêm GrapesJS vào frontend và mount Web Designer trong màn hình Sites.
- `SitePage.content` chuyển sang source envelope `type: "grapesjs"` cho page mới.
- Designer có block palette, canvas, style inspector, device preview và save project JSON.
- Thêm Data Binding block marker để DP5/runtime có thể map dữ liệu vào page.

---

## 2026-07-07 — DP1/DP2 Sites and Public Runtime

- Đổi nhóm Design and Publishing sang mã task DP.
- DP1: thêm Site/Page/DataBinding domain với CRUD, CM3 resource grants và UI Sites.
- DP2: thêm public runtime API `/public/sites/...` chỉ phục vụ site/page đã publish.
- Public data binding chạy F4 RowQuery đã lưu và chỉ trả các `field_ids` được whitelist.
- Thêm migration `3c5e7f9b0d1a` và tests cho publish gate, field pruning và site grants.

---

## 2026-07-07 — CM7 Google Drive Files & Media

- Thêm field type `files` cho Database, upload nhiều ảnh/tệp vào từng row.
- File bytes lưu trên Google Drive Shared Drive qua service account; database
  chỉ lưu metadata/reference.
- Thêm API upload, preview inline và delete có kiểm tra quyền database
  read/write.
- Table UI hỗ trợ `Files & media`, upload, xem ảnh/PDF/text trong modal nội bộ
  và xóa file.
- Cleanup Drive objects khi xóa field, row hoặc database chứa file.

---

## 2026-07-06 — CM5 Google identity and CM6 notifications

- Thêm Google Identity Services login, OAuth-only accounts và explicit account
  linking/unlinking an toàn.
- Thêm Account Settings cho connected identities và notification preferences.
- Thêm durable notification inbox, Redis unread count và bell UI.
- Membership/resource grant changes tạo notification qua transactional outbox.
- Email preference tạo idempotent durable job và gửi qua SMTP với retry.

---

## 2026-07-06 — CM4 Dashboard Designer

- Thêm Dashboard và DashboardWidget domain với Metric, Bar và Table widgets.
- Mở rộng F4 RowQuery bằng grouped aggregations giới hạn 100 nhóm.
- Widget data API thực thi query server-side và kiểm tra đồng thời quyền
  Dashboard lẫn Database.
- Thêm Dashboard list/designer, cấu hình database/field/calculation, Share qua
  CM3 và tự refresh dữ liệu mỗi 30 giây.

---

## 2026-07-06 — CM3 generic resource authorization

- Tổng quát hóa `DatabaseGrant` thành workspace-scoped `ResourceGrant`.
- Migration bảo toàn database grants hiện có và chuyển enforcement sang policy
  `read/write/manage` dùng chung.
- Documents hỗ trợ resource-level viewer/editor/manager; grant có thể nâng hoặc
  hạ quyền workspace và owner/admin luôn giữ toàn quyền.
- Thêm generic grant API, audit events, cleanup khi xóa resource và Share dialog
  dùng chung cho Databases/Documents.

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
- Thêm `PRODUCTION_PLAN.md` làm roadmap hiện hành; các plan MVP cũ sau đó được
  gộp vào changelog và xóa để tránh hai nguồn sự thật.
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
