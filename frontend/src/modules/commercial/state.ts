import { ApiError } from "@/lib/api/client";
import type {
  CommercialBootstrap,
  CommercialNavigationItem,
} from "@/modules/commercial/api";

export type CommercialFoundationState =
  | { kind: "loading" }
  | { kind: "no-access" }
  | { kind: "failed"; retryable: boolean }
  | {
      kind: "ready";
      bootstrap: CommercialBootstrap;
      destination: CommercialNavigationItem;
    };

export function resolveCommercialFoundationState({
  isPending,
  error,
  bootstrap,
  section,
}: {
  isPending: boolean;
  error: unknown;
  bootstrap: CommercialBootstrap | undefined;
  section: string;
}): CommercialFoundationState {
  if (isPending) return { kind: "loading" };
  if (error) {
    const retryable = !(error instanceof ApiError) || error.status >= 500;
    return { kind: "failed", retryable };
  }
  if (!bootstrap?.enabled) return { kind: "no-access" };
  const destination = bootstrap.destinations.find((item) => item.id === section);
  if (!destination) return { kind: "no-access" };
  return { kind: "ready", bootstrap, destination };
}
