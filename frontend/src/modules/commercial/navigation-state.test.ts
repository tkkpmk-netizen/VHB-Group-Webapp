import { describe, expect, it } from "vitest";
import type { CommercialBootstrap } from "@/modules/commercial/api";
import {
  readCommercialCheckpoint,
  resolveCommercialLanding,
  saveCommercialCheckpoint,
} from "@/modules/commercial/navigation-state";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const bootstrap = {
  enabled: true,
  module_id: "commercial-data",
  workspace_id: "workspace-1",
  capability_version: "v1",
  cohort: "foundation",
  as_of: "2026-07-30T00:00:00Z",
  destinations: [
    {
      id: "quality",
      href: "/commercial-data/quality",
      label_key: "navigation.quality",
      icon: "shield-alt",
      order: 10,
      capability: "commercial.quality.read",
      badge_source_id: "quality.open",
      badge_count: null,
      fallback_eligible: true,
    },
    {
      id: "pricing",
      href: "/commercial-data/pricing",
      label_key: "navigation.pricing",
      icon: "calculator",
      order: 20,
      capability: "commercial.pricing.read",
      badge_source_id: null,
      badge_count: null,
      fallback_eligible: false,
    },
  ],
} satisfies CommercialBootstrap;

describe("Commercial navigation checkpoint", () => {
  it("restores only a current authorized route", () => {
    const storage = memoryStorage();
    saveCommercialCheckpoint(storage, {
      workspaceId: "workspace-1",
      href: "/commercial-data/pricing",
      savedAt: 100,
    });
    const checkpoint = readCommercialCheckpoint(
      storage,
      "workspace-1",
      bootstrap.destinations.map((item) => item.href),
      200,
    );
    expect(resolveCommercialLanding(bootstrap, checkpoint)).toBe(
      "/commercial-data/pricing",
    );
  });

  it("discards an unauthorized checkpoint and uses the declared fallback", () => {
    const storage = memoryStorage();
    saveCommercialCheckpoint(storage, {
      workspaceId: "workspace-1",
      href: "/commercial-data/hidden",
      savedAt: 100,
    });
    const checkpoint = readCommercialCheckpoint(
      storage,
      "workspace-1",
      bootstrap.destinations.map((item) => item.href),
      200,
    );
    expect(checkpoint).toBeNull();
    expect(resolveCommercialLanding(bootstrap, checkpoint)).toBe(
      "/commercial-data/quality",
    );
  });
});
