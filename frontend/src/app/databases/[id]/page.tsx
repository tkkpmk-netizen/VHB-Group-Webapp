import { AppShell } from "@/components/layout/app-shell";
import { DatabaseView } from "@/components/table/database-view";

export default async function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <div className="flex h-full min-h-0 w-full flex-col">
        <DatabaseView databaseId={id} />
      </div>
    </AppShell>
  );
}
