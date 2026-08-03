import type { CommercialBootstrap } from "@/modules/commercial/api";

const CHECKPOINT_VERSION = 1;
const CHECKPOINT_TTL_MS = 30 * 60_000;

export type CommercialNavigationCheckpoint = {
  version: typeof CHECKPOINT_VERSION;
  workspaceId: string;
  href: string;
  savedAt: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function checkpointKey(workspaceId: string): string {
  return `vhb:commercial-navigation:${workspaceId}`;
}

export function saveCommercialCheckpoint(
  storage: StorageLike,
  checkpoint: Omit<CommercialNavigationCheckpoint, "version">,
): void {
  storage.setItem(
    checkpointKey(checkpoint.workspaceId),
    JSON.stringify({ ...checkpoint, version: CHECKPOINT_VERSION }),
  );
}

export function readCommercialCheckpoint(
  storage: StorageLike,
  workspaceId: string,
  allowedHrefs: readonly string[],
  now = Date.now(),
): CommercialNavigationCheckpoint | null {
  const key = checkpointKey(workspaceId);
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CommercialNavigationCheckpoint>;
    const valid =
      value.version === CHECKPOINT_VERSION &&
      value.workspaceId === workspaceId &&
      typeof value.href === "string" &&
      typeof value.savedAt === "number" &&
      now - value.savedAt <= CHECKPOINT_TTL_MS &&
      allowedHrefs.includes(value.href);
    if (valid) return value as CommercialNavigationCheckpoint;
  } catch {
    // Invalid or obsolete checkpoints are discarded below.
  }
  storage.removeItem(key);
  return null;
}

export function resolveCommercialLanding(
  bootstrap: CommercialBootstrap,
  checkpoint: CommercialNavigationCheckpoint | null,
): string | null {
  const allowed = bootstrap.destinations.map((item) => item.href);
  if (checkpoint && allowed.includes(checkpoint.href)) return checkpoint.href;
  return (
    bootstrap.destinations.find((item) => item.fallback_eligible)?.href ??
    bootstrap.destinations[0]?.href ??
    null
  );
}
