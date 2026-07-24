import { describe, expect, it } from "vitest";
import {
  calculationForField,
  calculationOptions,
  normalizeCalculation,
} from "./calculations";

describe("database calculations", () => {
  it("normalizes the legacy average operation", () => {
    expect(normalizeCalculation("average")).toBe("avg");
  });

  it("only exposes numeric aggregations for numeric fields", () => {
    expect(calculationOptions("text").map((option) => option.value)).not.toContain(
      "sum",
    );
    expect(calculationOptions("progress").map((option) => option.value)).toContain(
      "avg",
    );
  });

  it("drops persisted operations that are invalid for the field type", () => {
    expect(calculationForField("text", "sum")).toBeNull();
    expect(calculationForField("number", "average")).toBe("avg");
  });
});
