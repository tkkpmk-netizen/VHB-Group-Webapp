"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { HealthStatus } from "@/components/health-status";
import type { components } from "@/lib/api/schema";

type Workspace = components["schemas"]["WorkspaceOut"];
type Db = components["schemas"]["DatabaseOut"];

export function DashboardContent() {
  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace-me"],
    queryFn: () => apiFetch<Workspace>("/workspaces/me"),
    retry: false,
  });
  const { data: databases } = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
    retry: false,
  });

  const stats = [
    { label: "Databases", value: databases?.length ?? "—" },
    { label: "Tasks", value: "—" },
    { label: "Members", value: workspace?.member_count ?? "—" },
    { label: "Views", value: "—" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">
          {workspace ? workspace.name : "VHB Super App"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className="mt-2 text-3xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      <HealthStatus />
    </div>
  );
}
