import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./client-concurrency";

describe("mapWithConcurrency", () => {
  it("bounds parallel work and preserves input order", async () => {
    let active = 0;
    let peak = 0;

    const result = await mapWithConcurrency([5, 4, 3, 2, 1], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, value));
      active -= 1;
      return value * 10;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(result).toEqual([50, 40, 30, 20, 10]);
  });

  it("uses at least one worker for an invalid limit", async () => {
    await expect(
      mapWithConcurrency([1], 0, async (value) => value),
    ).resolves.toEqual([1]);
  });
});
