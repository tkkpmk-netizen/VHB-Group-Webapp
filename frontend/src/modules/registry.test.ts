import { describe, expect, it } from "vitest";
import { PRODUCT_MODULES } from "@/modules/registry";

describe("PRODUCT_MODULES", () => {
  it("has stable unique IDs and routes", () => {
    expect(new Set(PRODUCT_MODULES.map((item) => item.id)).size).toBe(
      PRODUCT_MODULES.length,
    );
    expect(new Set(PRODUCT_MODULES.map((item) => item.href)).size).toBe(
      PRODUCT_MODULES.length,
    );
  });

  it("owns Commercial context navigation through a remote descriptor", () => {
    const commercial = PRODUCT_MODULES.find(
      (item) => item.id === "commercial-data",
    );
    expect(commercial?.contextNavigation).toMatchObject({
      kind: "remote",
      endpoint: "/commercial/bootstrap",
      queryKey: "commercial-bootstrap",
    });
  });

  it("exposes Database as a standalone mini app without context navigation", () => {
    const database = PRODUCT_MODULES.find((item) => item.id === "database");
    expect(database).toMatchObject({
      label: "Database",
      href: "/databases",
      contextNavigation: { kind: "none" },
    });
  });
});
