import { AppShell } from "@/components/layout/app-shell";
import { OrderManagementWorkspace } from "@/modules/commercial/order-management";
import { JobTray } from "@/modules/commercial/workbench";

export default async function OrderManagementPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <AppShell><OrderManagementWorkspace initialTab={tab === "render" ? "render" : "overview"} /><JobTray /></AppShell>;
}
