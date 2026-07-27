import { describe, expect, it } from "vitest";
import {
  dragPreviewWidth,
  moveItemsBefore,
} from "../../lib/drag-preview";

describe("dragPreviewWidth", () => {
  it("keeps a table row ghost compact even when the source spans the table", () => {
    expect(dragPreviewWidth(1480, "row")).toBe(248);
  });

  it("keeps small layout and tree ghosts easy to read", () => {
    expect(dragPreviewWidth(60, "layout")).toBe(128);
    expect(dragPreviewWidth(90, "tree-item")).toBe(152);
  });

  it("preserves source width within the surface limits", () => {
    expect(dragPreviewWidth(210, "board-card")).toBe(210);
    expect(dragPreviewWidth(190, "column")).toBe(190);
  });
});

describe("moveItemsBefore", () => {
  it("previews multiple selected rows as one ordered block", () => {
    expect(
      moveItemsBefore(["a", "b", "c", "d", "e"], ["b", "d"], "e"),
    ).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("moves a contiguous block to the beginning", () => {
    expect(
      moveItemsBefore(["a", "b", "c", "d"], ["b", "c"], "a"),
    ).toEqual(["b", "c", "a", "d"]);
  });

  it("does not churn order while hovering a row inside the moving block", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveItemsBefore(ids, ["b", "c"], "c")).toBe(ids);
  });
});
