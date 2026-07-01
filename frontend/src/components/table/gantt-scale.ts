/** Pure timeline-scale helpers for the Gantt view (no React/app imports so they
 *  stay unit-testable without the `@/` alias). */

export type GanttScale =
  | "hour"
  | "day"
  | "week"
  | "biweek"
  | "month"
  | "quarter"
  | "year";

/** Step units used for header ticks (same set as the scales). */
export type Unit = GanttScale;

const DAY = 86_400_000;

/** Per "Time period": the column unit (minor) + header-group unit (major),
 *  the zoom (px/day) and the ± window radius (in days) kept loaded at once. */
export const PERIODS: Record<
  GanttScale,
  { label: string; minor: Unit; major: Unit; dayPx: number; windowDays: number }
> = {
  hour: { label: "Hour", minor: "hour", major: "day", dayPx: 1080, windowDays: 7 },
  day: { label: "Day", minor: "day", major: "week", dayPx: 48, windowDays: 28 },
  week: { label: "Week", minor: "week", major: "month", dayPx: 20, windowDays: 60 },
  biweek: { label: "2 weeks", minor: "biweek", major: "month", dayPx: 12, windowDays: 60 },
  month: { label: "Month", minor: "month", major: "quarter", dayPx: 6, windowDays: 120 },
  quarter: { label: "Quarter", minor: "quarter", major: "year", dayPx: 2.6, windowDays: 365 },
  year: { label: "Year", minor: "year", major: "year", dayPx: 1.2, windowDays: 730 },
};

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};

function alignDown(t: number, unit: Unit): Date {
  if (unit === "hour") {
    const d = new Date(t);
    d.setMinutes(0, 0, 0);
    return d;
  }
  const d = startOfDay(t);
  if (unit === "week" || unit === "biweek")
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  else if (unit === "month") d.setDate(1);
  else if (unit === "quarter") {
    d.setDate(1);
    d.setMonth(Math.floor(d.getMonth() / 3) * 3);
  } else if (unit === "year") d.setMonth(0, 1);
  return d;
}

function advance(d: Date, unit: Unit): void {
  if (unit === "hour") d.setHours(d.getHours() + 1);
  else if (unit === "day") d.setDate(d.getDate() + 1);
  else if (unit === "week") d.setDate(d.getDate() + 7);
  else if (unit === "biweek") d.setDate(d.getDate() + 14);
  else if (unit === "month") d.setMonth(d.getMonth() + 1);
  else if (unit === "quarter") d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
}

/** Tick boundary timestamps covering [from,to], aligned & stepped by unit.
 *  Guarded at 4000 so a fine unit over a huge span can't loop forever. */
export function unitTicks(from: number, to: number, unit: Unit): number[] {
  const d = alignDown(from, unit);
  const out: number[] = [];
  let g = 0;
  while (d.getTime() <= to && g++ < 4000) {
    out.push(d.getTime());
    advance(d, unit);
  }
  return out;
}

/** ISO-8601 week number. */
export function isoWeek(t: number): number {
  const date = new Date(t);
  const u = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (u.getUTCDay() + 6) % 7;
  u.setUTCDate(u.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(u.getUTCFullYear(), 0, 4));
  return 1 + Math.round((u.getTime() - firstThu.getTime()) / (7 * DAY));
}

const fmt = (t: number, o: Intl.DateTimeFormatOptions) =>
  new Date(t).toLocaleString(undefined, o);

/** Header label for a tick in its row role (minor = column, major = group). */
export function unitLabel(t: number, unit: Unit, role: "minor" | "major"): string {
  const c = new Date(t);
  switch (unit) {
    case "hour": {
      if (role === "major")
        return fmt(t, { weekday: "short", day: "numeric", month: "short" });
      // Short 12-hour label: 12a, 1a … 11a, 12p, 1p … 11p
      const h = c.getHours();
      return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
    }
    case "day":
      return `${fmt(t, { weekday: "short" })} ${c.getDate()}`;
    case "week":
    case "biweek": {
      const e = new Date(t);
      e.setDate(e.getDate() + (unit === "week" ? 6 : 13));
      const range = `${c.getDate()}–${e.getDate()}`;
      return role === "major"
        ? `W${isoWeek(t)} ${fmt(t, { month: "short" })} ${range}`
        : range;
    }
    case "month":
      return role === "major"
        ? fmt(t, { month: "short", year: "numeric" })
        : fmt(t, { month: "short" });
    case "quarter": {
      const q = Math.floor(c.getMonth() / 3) + 1;
      return role === "major" ? `${c.getFullYear()} Q${q}` : `Q${q}`;
    }
    case "year":
      return String(c.getFullYear());
  }
}

/** New [start,end] (ms) after dragging a bar: move both ends, or resize one
 *  end while clamping so start never crosses end. */
export function applyDrag(
  mode: "move" | "start" | "end",
  s: number,
  e: number,
  deltaMs: number,
): { start: number; end: number } {
  if (mode === "move") return { start: s + deltaMs, end: e + deltaMs };
  if (mode === "start") return { start: Math.min(s + deltaMs, e), end: e };
  return { start: s, end: Math.max(e + deltaMs, s) };
}

/** A value is "date-like" if it's a {start} object or a non-numeric string that
 *  parses to a valid date — used to detect formula fields that return a date. */
export function looksDate(v: unknown): boolean {
  if (v && typeof v === "object" && "start" in v) return true;
  if (typeof v !== "string" || /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return false;
  return !Number.isNaN(new Date(v).getTime());
}
