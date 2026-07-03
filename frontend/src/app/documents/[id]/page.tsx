import { AppShell } from "@/components/layout/app-shell";
import { DocumentClient } from "./document-client";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <DocumentClient documentId={id} />
    </AppShell>
  );
}
