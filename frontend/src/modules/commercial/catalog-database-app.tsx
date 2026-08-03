"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseView } from "@/components/table/database-view";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { workspaceQueryKeys } from "@/lib/query-keys";
import { useSelectedWorkspaceId } from "@/modules/commercial/api";

type CatalogKind = "products" | "customers" | "suppliers";
type CatalogBinding = {
  kind: CatalogKind;
  database_id: string;
  name: string;
  created: boolean;
};

export function CatalogDatabaseApp({ kind }: { kind: CatalogKind }) {
  const workspaceId = useSelectedWorkspaceId();
  const queryClient = useQueryClient();
  const binding = useQuery<CatalogBinding>({
    queryKey: ["commercial", "catalog-database", workspaceId, kind],
    queryFn: () =>
      apiFetch<CatalogBinding>(`/commercial/catalogs/${kind}/ensure`, {
        method: "POST",
      }),
    enabled: Boolean(workspaceId),
    retry: false,
  });

  useEffect(() => {
    if (!binding.data) return;
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeys.databases(workspaceId),
    });
  }, [binding.data, queryClient, workspaceId]);

  if (binding.isPending) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="h-[84px] animate-pulse border-b bg-muted/30" />
        <div className="h-14 animate-pulse border-b bg-muted/20" />
        <div className="m-5 flex-1 animate-pulse rounded-lg bg-muted/25" />
      </div>
    );
  }
  if (binding.isError || !binding.data) {
    return (
      <div className="flex h-full items-center justify-center bg-white p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-base font-semibold">Could not open {kind}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The catalog database could not be resolved for this workspace. An
            editor or owner may need to open it once to provision the work area.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void binding.refetch()}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }
  return <DatabaseView databaseId={binding.data.database_id} />;
}
