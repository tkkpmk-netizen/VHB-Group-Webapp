import {
  Database,
  FileText,
  FileSpreadsheet,
  Globe2,
  Home,
  Settings,
  Table2,
  Users,
  type LucideIcon,
} from "@/components/ui/fa-icon";
import { commercialText } from "@/modules/commercial/i18n";

export type RemoteContextNavigationItem = {
  id: string;
  href: string;
  label_key: string;
  icon: string;
  order: number;
  capability: string;
  badge_source_id: string | null;
  badge_count: number | null;
  fallback_eligible: boolean;
};

export type RemoteContextNavigationPayload = {
  enabled: boolean;
  module_id: string;
  workspace_id: string;
  capability_version: string;
  cohort: string;
  as_of: string;
  destinations: RemoteContextNavigationItem[];
};

export type ContextNavigationDescriptor =
  | { kind: "none" }
  | { kind: "global-links" }
  | {
      kind: "remote";
      endpoint: string;
      queryKey: string;
      resolveLabel: (key: string) => string;
    };

export type ProductModule = {
  id:
    | "home"
    | "database"
    | "commercial-data"
    | "products"
    | "customers"
    | "suppliers"
    | "order-list"
    | "documents"
    | "sites"
    | "people"
    | "settings";
  label: string;
  railLabel?: string;
  href: string;
  icon: LucideIcon;
  contextNavigation: ContextNavigationDescriptor;
};

export const PRODUCT_MODULES: ProductModule[] = [
  {
    id: "home",
    label: "Home",
    href: "/",
    icon: Home,
    contextNavigation: { kind: "global-links" },
  },
  {
    id: "database",
    label: "Database",
    href: "/databases",
    icon: Database,
    contextNavigation: { kind: "none" },
  },
  {
    id: "products",
    label: "Products",
    href: "/products",
    icon: Database,
    contextNavigation: { kind: "none" },
  },
  {
    id: "customers",
    label: "Customers",
    href: "/customers",
    icon: Users,
    contextNavigation: { kind: "none" },
  },
  {
    id: "suppliers",
    label: "Suppliers",
    href: "/suppliers",
    icon: Table2,
    contextNavigation: { kind: "none" },
  },
  {
    id: "order-list",
    label: "Order List",
    href: "/order-list",
    icon: FileSpreadsheet,
    contextNavigation: { kind: "none" },
  },
  {
    id: "commercial-data",
    label: "Commercial Data",
    railLabel: "Data",
    href: "/commercial-data",
    icon: Table2,
    contextNavigation: {
      kind: "remote",
      endpoint: "/commercial/bootstrap",
      queryKey: "commercial-bootstrap",
      resolveLabel: commercialText,
    },
  },
  {
    id: "documents",
    label: "Docs",
    href: "/documents",
    icon: FileText,
    contextNavigation: { kind: "global-links" },
  },
  {
    id: "sites",
    label: "Sites",
    href: "/sites",
    icon: Globe2,
    contextNavigation: { kind: "global-links" },
  },
  {
    id: "people",
    label: "People",
    href: "/settings/people",
    icon: Users,
    contextNavigation: { kind: "global-links" },
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings/account",
    icon: Settings,
    contextNavigation: { kind: "global-links" },
  },
];
