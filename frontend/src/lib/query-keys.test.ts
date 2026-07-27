import { describe, expect, it } from "vitest";
import { workspaceQueryKeys } from "./query-keys";

describe("workspaceQueryKeys", () => {
  it("normalizes space order so equivalent workspace requests share cache", () => {
    expect(workspaceQueryKeys.folders("workspace", ["b", "a"])).toEqual(
      workspaceQueryKeys.folders("workspace", ["a", "b"]),
    );
    expect(workspaceQueryKeys.placements("workspace", ["b", "a"])).toEqual(
      workspaceQueryKeys.placements("workspace", ["a", "b"]),
    );
  });
});
