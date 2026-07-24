import {
  Database,
  FileText,
  Globe2,
  Home,
  Settings,
  Users,
  type LucideIcon,
} from "@/components/ui/fa-icon";

export type ProductModule = {
  id:
    | "home"
    | "database"
    | "documents"
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
  { id: "sites", label: "Sites", href: "/sites", icon: Globe2 },
  { id: "people", label: "People", href: "/settings/people", icon: Users },
  { id: "settings", label: "Settings", href: "/settings/account", icon: Settings },
];
