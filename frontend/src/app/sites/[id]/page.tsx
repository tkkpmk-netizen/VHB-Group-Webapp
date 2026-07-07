import { AppShell } from "@/components/layout/app-shell";
import { SiteManager } from "@/components/sites/site-manager";

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <SiteManager siteId={id} />
    </AppShell>
  );
}
