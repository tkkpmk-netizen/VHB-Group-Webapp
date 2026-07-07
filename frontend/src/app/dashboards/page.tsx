"use client";

import { LayoutDashboard, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";

type Dashboard = {
  id: string;
  name: string;
  description: string | null;
};

export default function DashboardsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const { data: dashboards = [], isLoading } = useQuery<Dashboard[]>({
    queryKey: ["dashboards", workspaceId],
    queryFn: () => apiFetch<Dashboard[]>("/dashboards"),
  });
  const createDashboard = useMutation({
    mutationFn: () =>
      apiFetch<Dashboard>("/dashboards", {
        method: "POST",
        body: JSON.stringify({ name: "Untitled dashboard" }),
      }),
    onSuccess: (dashboard) => {
      queryClient.invalidateQueries({ queryKey: ["dashboards"] });
      router.push(`/dashboards/${dashboard.id}`);
    },
  });

  return (
    <AppShell>
      <div className="min-h-full">
        <header className="flex min-h-14 items-center gap-3 border-b px-5 py-2">
          <div>
            <h1 className="text-base font-semibold">Dashboards</h1>
            <p className="text-xs text-muted-foreground">
              Live views powered by your databases.
            </p>
          </div>
          <button
            type="button"
            disabled={createDashboard.isPending}
            onClick={() => createDashboard.mutate()}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Plus className="size-4" /> New dashboard
          </button>
        </header>
        <div className="mx-auto grid max-w-6xl gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {dashboards.map((dashboard) => (
            <Link
              key={dashboard.id}
              href={`/dashboards/${dashboard.id}`}
              className="rounded-xl border bg-card p-5 transition hover:border-blue-300 hover:shadow-sm"
            >
              <span className="mb-5 flex size-10 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <LayoutDashboard className="size-5" />
              </span>
              <h2 className="truncate text-sm font-semibold">
                {dashboard.name}
              </h2>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {dashboard.description || "No description"}
              </p>
            </Link>
          ))}
          {!isLoading && dashboards.length === 0 && (
            <button
              type="button"
              onClick={() => createDashboard.mutate()}
              className="col-span-full rounded-xl border border-dashed p-14 text-sm text-muted-foreground hover:bg-muted/30"
            >
              Create your first dashboard
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
