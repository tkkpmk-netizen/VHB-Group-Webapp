import { AppShell } from "@/components/layout/app-shell";
import { TableView } from "@/components/table/table-view";

export default async function DatabaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1800px]">
        <TableView databaseId={id} />
      </div>
    </AppShell>
  );
}
