import { AppShell } from "@/components/layout/app-shell";
import { CatalogDatabaseApp } from "@/modules/commercial/catalog-database-app";

export default function CustomersPage() {
  return <AppShell><CatalogDatabaseApp kind="customers" /></AppShell>;
}
