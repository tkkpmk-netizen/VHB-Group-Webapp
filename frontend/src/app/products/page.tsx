import { AppShell } from "@/components/layout/app-shell";
import { CatalogDatabaseApp } from "@/modules/commercial/catalog-database-app";

export default function ProductsPage() {
  return <AppShell><CatalogDatabaseApp kind="products" /></AppShell>;
}
