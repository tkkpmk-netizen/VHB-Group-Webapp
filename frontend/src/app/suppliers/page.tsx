import { AppShell } from "@/components/layout/app-shell";
import { CatalogDatabaseApp } from "@/modules/commercial/catalog-database-app";

export default function SuppliersPage() {
  return <AppShell><CatalogDatabaseApp kind="suppliers" /></AppShell>;
}
