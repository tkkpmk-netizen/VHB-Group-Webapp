import { AppShell } from "@/components/layout/app-shell";
import { DashboardDesigner } from "@/components/dashboards/dashboard-designer";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <DashboardDesigner dashboardId={id} />
    </AppShell>
  );
}
