"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { ViewsBar } from "@/components/table/views-bar";
import { ViewShell } from "@/components/table/view-shell";
import type { components } from "@/lib/api/schema";

type View = components["schemas"]["ViewOut"];
type Db = components["schemas"]["DatabaseOut"];

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const dbQ = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const viewsQ = useQuery<View[]>({
    queryKey: ["views", databaseId],
    queryFn: () => apiFetch<View[]>(`/databases/${databaseId}/views`),
  });

  const dbName = dbQ.data?.find((d) => d.id === databaseId)?.name ?? "Database";
  const views = viewsQ.data ?? [];
  const active = views.find((v) => v.id === activeId) ?? views[0];

  return (
    <div className="space-y-3">
      <div>
        <Link
          href="/databases"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Databases
        </Link>
        <h1 className="text-2xl font-bold">{dbName}</h1>
      </div>

      {active ? (
        <>
          <ViewsBar
            databaseId={databaseId}
            views={views}
            activeId={active.id}
            setActiveId={setActiveId}
          />
          <ViewShell key={active.id} databaseId={databaseId} view={active} />
        </>
      ) : (
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
