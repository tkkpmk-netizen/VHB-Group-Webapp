import { AppShell } from "@/components/layout/app-shell";
import { DatabaseView } from "@/components/table/database-view";

export default async function DatabaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placement?: string | string[]; layout?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const placementId = typeof query.placement === "string" ? query.placement : undefined;
  const layoutId = typeof query.layout === "string" ? query.layout : undefined;
  return (
    <AppShell>
      <div className="flex h-full min-h-0 w-full flex-col">
        <DatabaseView databaseId={id} placementId={placementId} initialLayoutId={layoutId} />
      </div>
    </AppShell>
  );
}
