import { describe, expect, it } from "vitest";
import { applyDrag, isoWeek, looksDate, unitLabel, unitTicks } from "./gantt-scale";

const at = (s: string) => new Date(s).getTime();

describe("unitTicks", () => {
  it("month unit aligns to first-of-month and steps monthly", () => {
    const ticks = unitTicks(at("2026-01-15"), at("2026-03-10"), "month");
    expect(ticks.map((t) => new Date(t).getMonth())).toEqual([0, 1, 2]);
    expect(new Date(ticks[0]).getDate()).toBe(1);
  });

  it("quarter unit snaps to Jan/Apr/Jul/Oct", () => {
    const ticks = unitTicks(at("2026-02-01"), at("2026-12-31"), "quarter");
    expect(ticks.map((t) => new Date(t).getMonth())).toEqual([0, 3, 6, 9]);
  });

  it("week unit steps by 7 days from a Monday", () => {
    const ticks = unitTicks(at("2026-06-10"), at("2026-06-30"), "week");
    expect(new Date(ticks[0]).getDay()).toBe(1); // Monday
    expect((ticks[1] - ticks[0]) / 86_400_000).toBe(7);
  });

  it("guards against runaway counts (hour over a year)", () => {
    expect(unitTicks(at("2026-01-01"), at("2027-01-01"), "hour").length).toBeLessThanOrEqual(
      4000,
    );
  });
});

describe("unitLabel", () => {
  it("month minor vs major differ (with/without year)", () => {
    expect(unitLabel(at("2026-06-01"), "month", "minor")).toMatch(/Jun|thg 6/i);
    expect(unitLabel(at("2026-06-01"), "month", "major")).toContain("2026");
  });
  it("quarter labels Q1..Q4", () => {
    expect(unitLabel(at("2026-04-01"), "quarter", "minor")).toBe("Q2");
    expect(unitLabel(at("2026-04-01"), "quarter", "major")).toBe("2026 Q2");
  });
  it("hour minor uses short 12-hour am/pm labels", () => {
    expect(unitLabel(at("2026-06-29T00:00"), "hour", "minor")).toBe("12a");
    expect(unitLabel(at("2026-06-29T01:00"), "hour", "minor")).toBe("1a");
    expect(unitLabel(at("2026-06-29T12:00"), "hour", "minor")).toBe("12p");
    expect(unitLabel(at("2026-06-29T13:00"), "hour", "minor")).toBe("1p");
  });
});

describe("isoWeek", () => {
  it("computes ISO week numbers", () => {
    expect(isoWeek(at("2026-01-01"))).toBe(1);
    expect(isoWeek(at("2026-06-25"))).toBe(26);
  });
});

describe("applyDrag (bar move / resize)", () => {
  const D = 86_400_000;
  it("move shifts both ends", () => {
    expect(applyDrag("move", 100, 200, 50)).toEqual({ start: 150, end: 250 });
  });
  it("resize start clamps so it can't pass end", () => {
    expect(applyDrag("start", 100, 200, 50)).toEqual({ start: 150, end: 200 });
    expect(applyDrag("start", 100, 200, 999)).toEqual({ start: 200, end: 200 });
  });
  it("resize end clamps so it can't pass start", () => {
    expect(applyDrag("end", 100, 200, 5 * D)).toEqual({ start: 100, end: 200 + 5 * D });
    expect(applyDrag("end", 100, 200, -999)).toEqual({ start: 100, end: 100 });
  });
});

describe("looksDate (formula date detection)", () => {
  it("accepts ISO strings and {start} objects", () => {
    expect(looksDate("2026-06-28")).toBe(true);
    expect(looksDate("2026-06-28T10:00:00")).toBe(true);
    expect(looksDate({ start: "2026-06-28", end: null })).toBe(true);
  });
  it("rejects plain numbers and junk so numeric formulas aren't offered", () => {
    expect(looksDate("30")).toBe(false);
    expect(looksDate("1.08")).toBe(false);
    expect(looksDate(42)).toBe(false);
    expect(looksDate("hello")).toBe(false);
    expect(looksDate(null)).toBe(false);
  });
});
