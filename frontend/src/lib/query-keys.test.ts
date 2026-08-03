import { describe, expect, it } from "vitest";
import { workspaceQueryKeys } from "@/lib/query-keys";

describe("workspaceQueryKeys", () => {
  it("scopes the database inventory by workspace", () => {
    expect(workspaceQueryKeys.databases("workspace-a")).toEqual([
      "databases",
      "workspace-a",
    ]);
  });
});
