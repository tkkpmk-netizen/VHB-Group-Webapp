import { describe, expect, it } from "vitest";
import { mergeUniqueById } from "./entity-tree";

describe("mergeUniqueById", () => {
  it("keeps one Entity per id and lets the fresh page replace a tree snapshot", () => {
    const tree = [
      { id: "parent", name: "Old parent" },
      { id: "child", name: "Child" },
    ];
    const page = [
      { id: "parent", name: "Fresh parent" },
      { id: "sibling", name: "Sibling" },
    ];

    expect(mergeUniqueById(tree, page)).toEqual([
      { id: "parent", name: "Fresh parent" },
      { id: "child", name: "Child" },
      { id: "sibling", name: "Sibling" },
    ]);
  });
});
