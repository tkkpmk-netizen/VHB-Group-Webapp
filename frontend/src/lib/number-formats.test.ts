import { describe, expect, it } from "vitest";
import { formatComputedValue, formatNumberValue } from "./number-formats";

describe("number formatting", () => {
  it("formats computed USD values to the configured precision", () => {
    const value = formatComputedValue(522327.18000000005, {
      format: "currency",
      currency_code: "USD",
      precision: 2,
    });
    expect(value).toMatch(/\$522,327\.18|USD\s*522,327\.18/);
  });

  it("supports configurable decimal places", () => {
    expect(formatNumberValue(0.265, { format: "decimal", precision: 3 })).toBe(
      "0.265",
    );
  });
});
