const commercialEnglish = {
  "module.title": "Commercial Data",
  "module.description":
    "Govern product, customer, pricing, and source-data quality in one workspace.",
  "navigation.quality": "Quality Control",
  "navigation.products": "Products",
  "navigation.customers": "Customers",
  "navigation.pricing": "Pricing",
  "navigation.render": "Render Lab",
  "state.loading": "Loading Commercial Data",
  "state.noAccess": "Commercial Data is not available in this workspace.",
  "state.failed": "Commercial Data could not be loaded.",
  "action.retry": "Try again",
  "action.openHelp": "Hướng dẫn bằng tiếng Việt",
  "empty.quality.title": "No quality work is waiting",
  "empty.quality.body":
    "Import and reconciliation batches will appear here after a governed source is published.",
  "empty.products.title": "No governed products are available yet",
  "empty.products.body":
    "Published product identities, packs, aliases, and evidence will appear here.",
  "empty.customers.title": "No governed customers are available yet",
  "empty.customers.body":
    "Published customer accounts, legal parties, contacts, and evidence will appear here.",
  "empty.pricing.title": "No governed price versions are available yet",
  "empty.pricing.body":
    "Published cost inputs, margins, price versions, and approval work will appear here.",
  "empty.render.title": "No Order List render is running",
  "empty.render.body": "Enter or import an Order List snapshot to render XLSX and PDF artifacts.",
} as const;

export type CommercialTextKey = keyof typeof commercialEnglish;

export const commercialHelpEnglish = {
  quality:
    "This workspace will collect source-data exceptions and preserve the evidence used to resolve them.",
  products:
    "This workspace will hold governed product identities without changing historical transaction snapshots.",
  customers:
    "This workspace will separate customer accounts, legal parties, contacts, and addresses.",
  pricing:
    "This workspace will show versioned cost, margin, price, and approval evidence.",
  render:
    "This workspace creates reviewable XLSX and PDF Order Lists from immutable snapshots.",
} as const;

export const commercialHelpVietnamese: Record<
  keyof typeof commercialHelpEnglish,
  string
> = {
  quality:
    "Khu vực này sẽ tập hợp các lỗi dữ liệu nguồn và lưu bằng chứng dùng để xử lý từng lỗi.",
  products:
    "Khu vực này sẽ quản lý danh tính sản phẩm chuẩn mà không làm thay đổi dữ liệu giao dịch lịch sử.",
  customers:
    "Khu vực này sẽ tách biệt tài khoản khách hàng, pháp nhân, người liên hệ và địa chỉ.",
  pricing:
    "Khu vực này sẽ hiển thị giá vốn, margin, phiên bản giá và bằng chứng phê duyệt.",
  render:
    "Khu vực này tạo Order List XLSX và PDF có thể kiểm tra từ dữ liệu snapshot bất biến.",
};

export function commercialText(key: string): string {
  return key in commercialEnglish
    ? commercialEnglish[key as CommercialTextKey]
    : key;
}
