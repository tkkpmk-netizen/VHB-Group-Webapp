import {
  Database,
  FileText,
  Globe2,
  Home,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type ProductModule = {
  id:
    | "home"
    | "database"
    | "documents"
    | "dashboards"
    | "sites"
    | "people"
    | "settings";
  label: string;
  href: string;
  icon: LucideIcon;
};

export const PRODUCT_MODULES: ProductModule[] = [
  { id: "home", label: "Home", href: "/", icon: Home },
  { id: "database", label: "Spaces", href: "/databases", icon: Database },
  { id: "documents", label: "Docs", href: "/documents", icon: FileText },
  {
    id: "dashboards",
    label: "Dashboards",
    href: "/dashboards",
    icon: LayoutDashboard,
  },
  { id: "sites", label: "Sites", href: "/sites", icon: Globe2 },
  { id: "people", label: "People", href: "/settings/people", icon: Users },
  { id: "settings", label: "Settings", href: "/settings/account", icon: Settings },
];
