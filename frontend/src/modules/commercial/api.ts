"use client";

import { useQuery } from "@tanstack/react-query";
import {
  apiFetch,
  getWorkspaceId,
  selectWorkspace,
} from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

export type CommercialBootstrap =
  components["schemas"]["CommercialBootstrapOut"];
export type CommercialNavigationItem =
  components["schemas"]["CommercialNavigationItem"];
type Membership = components["schemas"]["MembershipOut"];

export const commercialQueryKeys = {
  bootstrap: (workspaceId: string | null) =>
    ["commercial-bootstrap", workspaceId] as const,
};

export function useCommercialBootstrap(
  workspaceId: string | null,
  enabled = true,
) {
  return useQuery<CommercialBootstrap>({
    queryKey: commercialQueryKeys.bootstrap(workspaceId),
    queryFn: () => apiFetch<CommercialBootstrap>("/commercial/bootstrap"),
    enabled: enabled && Boolean(workspaceId),
  });
}

export function useSelectedWorkspaceId(): string | null {
  const memberships = useQuery<Membership[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const result = await apiFetch<Membership[]>("/workspaces");
      if (!getWorkspaceId() && result[0]) selectWorkspace(result[0].id);
      return result;
    },
    retry: false,
  });
  return getWorkspaceId() ?? memberships.data?.[0]?.id ?? null;
}
