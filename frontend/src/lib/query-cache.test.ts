import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "./query-cache";

describe("createAppQueryClient", () => {
  it("keeps reusable data in tab memory without focus refetches", () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(120_000);
    expect(defaults?.gcTime).toBe(900_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
  });

  it("retains metadata longer than large record pages", () => {
    const client = createAppQueryClient();

    expect(client.getQueryDefaults(["fields", "database-id"]).gcTime).toBe(
      3_600_000,
    );
    expect(client.getQueryDefaults(["entities", "database-id"]).gcTime).toBe(
      900_000,
    );
  });
});
