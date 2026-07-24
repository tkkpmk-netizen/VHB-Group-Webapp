# ClickUp UI Runtime Analysis

## Mục đích

Tài liệu này ghi lại các đặc điểm UI và UX quan sát trực tiếp từ ClickUp desktop để làm tham chiếu cho VHB Super App. Đây là phân tích hành vi và hình thức ở runtime, không phải sao chép mã nguồn hay tài sản độc quyền của ClickUp.

Phạm vi quan sát tập trung vào cấu trúc workspace, context sidebar, cây Space/Folder/List, Dashboard, modal tạo Space và hành vi kéo thả. Các quyết định sản phẩm riêng của VHB vẫn ưu tiên hơn hành vi gốc của ClickUp.

## Môi trường quan sát

| Thuộc tính | Giá trị |
|---|---|
| Ứng dụng | ClickUp desktop for macOS |
| Kiến trúc vỏ ứng dụng | Electron/ToDesktop |
| Runtime giao diện | Web app từ `app.clickup.com` |
| Framework quan sát được | Angular custom elements, Angular CDK |
| Bố cục Dashboard | GridStack, lưới 12 cột |
| Ngày quan sát | 17/07/2026 |

## Cấu trúc khung ứng dụng

ClickUp tổ chức màn hình thành bốn lớp ổn định:

1. Global topbar chứa tìm kiếm, điều hướng và tác vụ toàn cục.
2. App rail hẹp ở mép trái chứa các module cấp cao.
3. Context sidebar thay đổi theo module và sở hữu vùng cuộn riêng.
4. Work area hiển thị nội dung đang chọn, không bị đẩy bởi menu hay popover.

Các số đo runtime chính:

| Thành phần | Số đo quan sát |
|---|---:|
| Global topbar | 40px |
| App rail | 52px phần màu, vùng tổng khoảng 64px |
| Context sidebar | 256px |
| Điểm bắt đầu work area | x = 320px |
| Hàng cây sidebar | 30px |
| View tab | 24px |
| Gutter Dashboard | 16px |
| Bo góc card Dashboard | 12px |

`body` không cuộn. Mỗi vùng nội dung quan trọng, đặc biệt context sidebar, tự quản lý overflow. Cách này giữ topbar và điều hướng ổn định khi dữ liệu dài.

## Ngôn ngữ hình ảnh

### Màu và bề mặt

| Vai trò | Giá trị quan sát |
|---|---|
| Chữ chính | `#202020` |
| Chữ phụ | `#646464` |
| Chữ cấp ba | `#838383` |
| Canvas/sidebar | `#F9F9F9` |
| Card | `#FFFFFF` |
| Viền | xám rất nhạt, chỉ đủ phân lớp |

ClickUp dùng màu thương hiệu cho trạng thái và hành động, không dùng để trang trí diện rộng. Canvas gần trắng tạo nền cho card trắng; chiều sâu đến chủ yếu từ viền, tương phản bề mặt và khoảng cách thay vì bóng đổ lớn.

### Typography

- Font hệ thống, ưu tiên khả năng đọc ở mật độ cao.
- Cỡ phổ biến: 13px, 14px và 16px.
- Body thường dùng weight 400.
- Label và điều hướng dùng weight 500.
- Tiêu đề card dùng weight 600.
- Phân cấp dựa nhiều vào weight và màu chữ hơn là tăng mạnh kích thước.

### Hình học và chuyển động

- Control nhỏ có radius khoảng 5-8px.
- Card, menu và dialog có radius khoảng 12px.
- Chuyển trạng thái thường trong 125-300ms, phổ biến nhất khoảng 200ms.
- Hover thay đổi màu nền, màu chữ hoặc opacity; không làm thay đổi kích thước hàng.
- Popover và menu nổi trên nội dung, không đẩy layout.

## Context sidebar và cây tài nguyên

### Space

- Space là node cấp cao trong cây.
- Hàng Space giữ chiều cao 30px dù đang idle hay hover.
- Click vào tên Space điều hướng nội dung; caret chỉ điều khiển đóng/mở cây con.
- Vùng thả của Space nhận item và đưa item về root của Space.

### Folder

- Folder chỉ là disclosure node trong sidebar.
- Click caret thay đổi `aria-expanded` và đóng/mở cây con.
- URL và work area không đổi khi chỉ đóng/mở Folder.
- Khi hover, caret và các action `More`/`Add` hiện bằng opacity hoặc visibility; tên co lại trong phần diện tích còn lại nhưng chiều cao hàng không đổi.
- Action quan trọng vẫn phải có đường dùng bằng bàn phím, menu và thiết bị không có hover.

### Database/List item

- Item trong cây có drag handle và overflow menu.
- Tree runtime sử dụng `.cdk-drop-list` và `.cdk-drag`.
- Kéo thả cung cấp phản hồi trực tiếp ở vùng nhận.
- Menu là phương án thay thế cho thao tác kéo thả, cần thiết cho accessibility và thiết bị cảm ứng.

## Dashboard

Dashboard dùng lưới 12 cột. Ở màn hình quan sát:

- Hàng đầu gồm ba card, mỗi card rộng 4 cột.
- Card ngoài khoảng 557 x 318px; vùng nội dung bên trong khoảng 541 x 302px.
- Các khu vực Folder và List có thể chiếm đủ 12 cột.
- Resources và Workload có thể chia đôi, mỗi vùng 6 cột.
- Khoảng cách giữa card là 16px.

Dashboard của VHB thuộc trực tiếp một Space. Đây là điểm khác có chủ đích so với việc coi Dashboard như module riêng.

## Modal tạo Space

Modal quan sát được có các đặc điểm:

| Thành phần | Số đo |
|---|---:|
| Dialog | khoảng 551 x 444px |
| Radius | 12px |
| Scrim | gần `rgba(0, 0, 0, 0.6)` |
| Input | 36px |
| CTA | 32px |
| Close button | 24px |
| Switch | khoảng 36 x 21px |

VHB giữ nhịp hình ảnh này nhưng tăng vùng bấm khi cần để đạt accessibility, thêm close button rõ ràng, focus ring và đường thoát bằng phím Escape.

## Ánh xạ vào mô hình VHB

| ClickUp reference | Quyết định của VHB |
|---|---|
| Space chứa cây Folder/List | Space chứa Folder và các placement của Database |
| List thuộc một vị trí trong hierarchy | Một Database có thể được đặt trong nhiều Space |
| Overview là một view có thể chọn | Click Space luôn mở Dashboard mặc định của Space |
| Folder click đóng/mở cây | Giữ nguyên; Folder không thay đổi work area |
| All items nằm trong hierarchy | `All Database` là kho chuẩn, placement không nhân bản Database |
| Quản lý hierarchy chủ yếu ở sidebar | Thêm `Space Management` dạng file manager với Database bar bên phải |

### Quy tắc điều hướng VHB

```text
Space click        -> mở Dashboard mặc định của Space
Folder disclosure  -> chỉ đóng/mở node con, work area giữ nguyên
Database click     -> mở Database
All Database       -> mở kho Database chuẩn của workspace
Space Management   -> mở trình quản lý Space/Folder và Database bar
```

Workspace switching của VHB có chủ đích khác ClickUp reference: bộ chọn được
đưa sang cụm tài khoản bên phải topbar, hiển thị thành avatar initials duy nhất.
Dropdown vẫn cho biết workspace hiện tại, role và user identity nhưng không còn
chiếm một hàng phía trên context sidebar.

### Quy tắc dữ liệu VHB

- Database là tài nguyên chuẩn, tồn tại độc lập với Space.
- Space chứa placement trỏ đến Database, không chứa bản sao Database.
- Cùng một Database có thể xuất hiện trong nhiều Space.
- Mỗi placement lưu folder, thứ tự và cấu hình hiển thị theo Space.
- Gỡ placement không xóa Database khỏi `All Database` hoặc khỏi Space khác.
- Breadcrumb của Database phải liệt kê mọi placement path hợp lệ; không dùng
  đường dẫn giả `Databases / Database workspace`.

## Chuẩn icon và tương tác Database bổ sung

- VHB dùng Font Awesome Free 5.15.3 Solid do chủ dự án cung cấp làm family duy
  nhất. Màu semantic học theo khả năng nhận diện của ClickUp: Space tím, Folder
  hồng tím, Database xanh, Calendar cam, Relation xanh ngọc.
- Space, Folder, Database, Layout, Field và Document đều chọn được icon, lưu
  bằng tên glyph ở backend và hiển thị qua SVG mask dùng `currentColor`.
- Layout tabs bắt đầu từ trái. Bốn utility cố định ở mép phải Layout bar theo
  thứ tự Search, Automation, Share, Import/Export. Search mở popover 320px neo
  phải phía dưới nên không làm tab Layout giãn hoặc co.
- Khi kéo, item nguồn vẫn nằm tại toolbar/cây và nhận trạng thái selected; VHB
  không dùng ghost/preview rời. Customize bắt đầu dưới Layout bar và không che
  breadcrumb, Database header hoặc các tab.
- Entity mở thành modal có thể sửa cell. Từ modal có thể tạo Document liên kết
  bằng `source_entity_id`; BlockNote mở thành popup window lớn kiểu Notion page,
  có metadata ẩn/hiện và giữ nguyên context của Layout phía sau.

## Accessibility cần tốt hơn bản tham chiếu

Một số giới hạn quan sát thấy ở ClickUp không nên sao chép:

- Một số icon button có vùng bấm nhỏ.
- Một số action chỉ dễ phát hiện khi hover.
- Một số button hover thiếu tên truy cập rõ ràng.
- Focus trong modal có thể thoát ra nền.

Yêu cầu cho VHB:

- Tất cả icon button có `aria-label`.
- Focus ring luôn nhìn thấy bằng bàn phím.
- Menu cung cấp phương án thay thế cho kéo thả.
- Action ẩn khi hover phải hiện khi focus và trên thiết bị không hỗ trợ hover.
- Modal có close button, Escape và quản lý focus hợp lý.
- Chuyển động tôn trọng `prefers-reduced-motion`.

## Token đề xuất cho VHB

Các token dưới đây tái hiện mật độ ClickUp nhưng giữ thương hiệu xanh của VHB:

```css
--app-rail-width: 52px;
--app-topbar-height: 40px;
--context-sidebar-width: 256px;

--surface-canvas: #f9f9f9;
--surface-card: #ffffff;
--surface-hover: #eef0f2;
--text-primary: #202020;
--text-secondary: #646464;
--text-tertiary: #838383;

--radius-control: 6px;
--radius-panel: 12px;
--motion-fast: 120ms;
--motion-standard: 200ms;
```

## Tiêu chí nghiệm thu UI Database

- Khung desktop dùng topbar 40px, rail 52px và context sidebar 256px.
- Tree row cao 30px và không nhảy layout khi hover.
- Space mở Dashboard; Folder chỉ disclosure.
- `All Database` và `Space Management` nằm cuối context sidebar.
- `Space Management` hiển thị rõ Space, Folder và placement theo cấu trúc file.
- Database header hiển thị đúng mọi đường dẫn Space/Folder của Database.
- Search trên Layout bar mở dạng overlay và không làm Layout tab dịch chuyển.
- Entity mở/chỉnh sửa được trong modal; tạo Doc từ Entity mở được popup editor.
- Workspace selector là avatar bên phải topbar, nằm ngay trước Log out.
- Database bar nằm bên phải work area trên desktop và chuyển thành panel dưới trên màn hình nhỏ.
- Kéo Database vào Space/Folder không làm mất placement ở Space khác.
- Có menu thay thế mọi tác vụ kéo thả quan trọng.
- Không dùng native `<select>` hoặc menu hệ điều hành.
- UI hoạt động ở 375px, 768px, 1024px và 1440px mà không tạo horizontal overflow ngoài vùng dữ liệu có chủ đích.
