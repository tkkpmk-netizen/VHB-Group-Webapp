"use client";

import { ArrowRight, Database, FolderTree, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Workspace = components["schemas"]["WorkspaceOut"];
type Db = components["schemas"]["DatabaseOut"];
type Space = components["schemas"]["SpaceOut"];

export function DashboardContent() {
  const workspaceId = getWorkspaceId();
  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace-me", workspaceId],
    queryFn: () => apiFetch<Workspace>("/workspaces/me"),
  });
  const { data: databases = [] } = useQuery<Db[]>({
    queryKey: ["databases", workspaceId],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ["spaces", workspaceId],
    queryFn: () => apiFetch<Space[]>("/spaces"),
  });

  const stats = [
    { label: "Spaces", value: spaces.length, icon: FolderTree, color: "text-violet-600 bg-violet-50" },
    { label: "Databases", value: databases.length, icon: Database, color: "text-blue-600 bg-blue-50" },
    { label: "Members", value: workspace?.member_count ?? "—", icon: Users, color: "text-emerald-600 bg-emerald-50" },
    { label: "Your role", value: workspace?.role ?? "—", icon: ShieldCheck, color: "text-amber-600 bg-amber-50" },
  ];

  return (
    <div className="min-h-full">
      <header className="border-b px-6 py-5">
        <h1 className="text-xl font-semibold">Workspace overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {workspace?.name ?? "Loading workspace…"}
        </p>
      </header>
      <div className="mx-auto max-w-6xl space-y-7 p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border bg-card p-4">
              <div className={`mb-4 flex size-9 items-center justify-center rounded-lg ${stat.color}`}>
                <stat.icon className="size-4" />
              </div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-1 truncate text-xl font-semibold capitalize">{stat.value}</p>
            </div>
          ))}
        </div>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent databases</h2>
            <Link href="/databases" className="flex items-center gap-1 text-xs font-medium text-[#1264d7]">
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border">
            {databases.slice(0, 6).map((database) => (
              <Link
                key={database.id}
                href={`/databases/${database.id}`}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-[#f7faff]"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-[#e8f1ff] text-[#1264d7]">
                  <Database className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{database.name}</span>
                <ArrowRight className="size-4 text-muted-foreground" />
              </Link>
            ))}
            {!databases.length && (
              <div className="p-10 text-center">
                <p className="text-sm text-muted-foreground">No databases yet.</p>
                <Link href="/databases" className="mt-3 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-white">
                  Create your first database
                </Link>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
