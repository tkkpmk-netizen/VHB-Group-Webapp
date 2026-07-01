"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { looksDate } from "@/components/table/gantt-scale";
import { applyFilterTree, type FilterGroup } from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];
type CalMode = "day" | "4days" | "week" | "month" | "year";

const MODES: { value: CalMode; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "4days", label: "4 days" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];
const HOUR_PX = 48;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DATE_TYPES = new Set(["date", "created_time", "last_edited_time"]);

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const p2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const ymdhm = (d: Date) => `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

/** Parse "YYYY-MM-DD[THH:mm]" as LOCAL time. */
function parseLocal(s: string): { d: Date; dateOnly: boolean } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : { d, dateOnly: false };
  }
  const [, y, mo, da, hh, mm] = m;
  if (hh != null)
    return { d: new Date(+y, +mo - 1, +da, +hh, +mm), dateOnly: false };
  return { d: new Date(+y, +mo - 1, +da), dateOnly: true };
}

type CalEvent = {
  row: Row;
  start: Date;
  end: Date;
  allDay: boolean;
  hasEnd: boolean;
};

function parseEvent(row: Row, fieldId: string): CalEvent | null {
  const v = (row.data as Record<string, unknown>)[fieldId];
  let sStr: string | undefined;
  let eStr: string | null | undefined;
  if (typeof v === "string") sStr = v;
  else if (v && typeof v === "object") {
    const o = v as { start?: string; end?: string | null };
    sStr = o.start;
    eStr = o.end;
  }
  if (!sStr) return null;
  const sp = parseLocal(sStr);
  if (!sp) return null;
  let end = sp.d;
  let hasEnd = false;
  if (eStr) {
    const ep = parseLocal(eStr);
    if (ep) {
      end = ep.d;
      hasEnd = true;
    }
  }
  if (end.getTime() < sp.d.getTime()) end = sp.d;
  return { row, start: sp.d, end, allDay: sp.dateOnly, hasEnd };
}

export function CalendarView({
  databaseId,
  calendarField,
  setCalendarField,
  calendarMode,
  setCalendarMode,
  filterRoot,
  filterToMatches,
  matchedIds,
}: {
  databaseId: string;
  calendarField: string | null;
  setCalendarField: (id: string | null) => void;
  calendarMode: string;
  setCalendarMode: (m: string) => void;
  filterRoot: FilterGroup;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
}) {
  const qc = useQueryClient();
  const [now] = useState(() => new Date());
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);
  const gridScroll = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const rowsQ = useQuery<Row[]>({
    queryKey: ["rows", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
  });
  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let rows = applyFilterTree(rowsQ.data ?? [], byId, filterRoot);
  if (filterToMatches && matchedIds) rows = rows.filter((r) => matchedIds.has(r.id));

  const dateFields = fields.filter(
    (f) =>
      DATE_TYPES.has(f.type) ||
      (f.type === "formula" &&
        rows.some((r) => looksDate((r.data as Record<string, unknown>)[f.id]))),
  );
  const picked = calendarField ? byId[calendarField] : undefined;
  const field =
    (picked && dateFields.includes(picked) ? picked : undefined) ?? dateFields[0];
  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  const title = (r: Row) => {
    const v = titleField ? (r.data as Record<string, unknown>)[titleField.id] : null;
    return typeof v === "string" && v ? v : `#${r.seq}`;
  };
  const editable = field?.type === "date";

  const mode = (calendarMode as CalMode) ?? "month";
  const events = field
    ? rows.map((r) => parseEvent(r, field.id)).filter((e): e is CalEvent => !!e)
    : [];

  const save = useMutation({
    mutationFn: ({ rowId, value }: { rowId: string; value: unknown }) =>
      apiFetch<Row>(`/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ data: { [field!.id]: value } }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows", databaseId] }),
  });

  /** Move an event to a new start, keeping its duration. */
  function reschedule(ev: CalEvent, newStart: Date) {
    const dur = ev.end.getTime() - ev.start.getTime();
    const ne = new Date(newStart.getTime() + dur);
    const fmt = ev.allDay ? ymd : ymdhm;
    save.mutate({
      rowId: ev.row.id,
      value: { start: fmt(newStart), end: ev.hasEnd ? fmt(ne) : null },
    });
  }

  // --- Navigation ---
  const step = (dir: 1 | -1) => {
    if (mode === "year") setAnchor((a) => new Date(a.getFullYear() + dir, a.getMonth(), 1));
    else if (mode === "month")
      setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
    else if (mode === "week") setAnchor((a) => addDays(a, 7 * dir));
    else if (mode === "4days") setAnchor((a) => addDays(a, 4 * dir));
    else setAnchor((a) => addDays(a, dir));
  };
  const headerTitle =
    mode === "year"
      ? String(anchor.getFullYear())
      : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const tzMin = -new Date().getTimezoneOffset();
  const tzLabel = `GMT${tzMin >= 0 ? "+" : "-"}${Math.abs(tzMin) / 60}`;

  if (!field)
    return (
      <div className="flex h-full flex-col">
        {header()}
        <div className="m-3 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Calendar cần một field ngày (Date / Created time / Last edited time / Formula
          ngày).
        </div>
      </div>
    );

  function header() {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <button
          onClick={() => step(-1)}
          title="Previous period"
          className="rounded p-1 hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={() => step(1)}
          title="Next period"
          className="rounded p-1 hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="min-w-28 text-base font-semibold">{headerTitle}</span>
        <button
          onClick={() => setAnchor(startOfDay(new Date()))}
          className="rounded-md border px-2.5 py-1 text-sm hover:bg-muted"
        >
          Today
        </button>
        {dateFields.length > 1 && (
          <div className="min-w-36 flex-1 sm:flex-none">
            <Dropdown
              value={field?.id ?? null}
              options={dateFields.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) => setCalendarField(v)}
            />
          </div>
        )}
        <div className="ml-auto w-28">
          <Dropdown
            value={mode}
            allowClear={false}
            options={MODES}
            onChange={(v) => v && setCalendarMode(v)}
          />
        </div>
      </div>
    );
  }

  // ---------- Time grid (day / 4days / week) ----------
  function timeGrid(days: Date[]) {
    const eventsForDay = (day: Date) =>
      events.filter((e) => !e.allDay && sameDay(e.start, day));
    const allDayForDay = (day: Date) =>
      events.filter(
        (e) => e.allDay && startOfDay(e.start) <= day && startOfDay(e.end) >= day,
      );
    const attach = (el: HTMLDivElement | null) => {
      gridScroll.current = el;
      if (el && !didScroll.current) {
        el.scrollTop = 7 * HOUR_PX; // open near 7am
        didScroll.current = true;
      }
    };
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Day headers */}
        <div className="flex shrink-0 border-b">
          <div className="w-14 shrink-0 text-center text-[11px] text-muted-foreground">
            {tzLabel}
          </div>
          {days.map((d) => {
            const today = sameDay(d, now);
            return (
              <div key={+d} className="min-w-0 flex-1 py-1 text-center text-sm">
                <span className="text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}{" "}
                </span>
                <span
                  className={
                    today
                      ? "inline-flex size-6 items-center justify-center rounded-full bg-red-500 font-medium text-white"
                      : "font-medium"
                  }
                >
                  {d.getDate()}
                </span>
              </div>
            );
          })}
        </div>
        {/* All-day row */}
        <div className="flex shrink-0 border-b">
          <div className="w-14 shrink-0 py-1 pr-1 text-right text-[11px] text-muted-foreground">
            All day
          </div>
          {days.map((d) => (
            <div
              key={+d}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={() => {
                const ev = events.find((x) => x.row.id === dragId);
                if (ev) reschedule(ev, startOfDay(d));
                setDragId(null);
              }}
              className="min-h-[26px] min-w-0 flex-1 space-y-0.5 border-l px-1 py-0.5"
            >
              {allDayForDay(d).map((ev) => (
                <div
                  key={ev.row.id}
                  draggable={editable}
                  onDragStart={() => setDragId(ev.row.id)}
                  className="truncate rounded bg-primary/15 px-1 text-xs text-primary"
                >
                  {title(ev.row)}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Hour grid */}
        <div ref={attach} className="min-h-0 flex-1 overflow-auto">
          <div className="flex" style={{ height: 24 * HOUR_PX }}>
            <div className="relative w-14 shrink-0">
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={h}
                  style={{ height: HOUR_PX }}
                  className="relative text-right text-[11px] text-muted-foreground"
                >
                  <span className="absolute -top-1.5 right-1">
                    {h === 0 ? "" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`}
                  </span>
                </div>
              ))}
              {/* Current-time badge in the gutter */}
              <span
                className="absolute right-0.5 z-10 -translate-y-1/2 rounded bg-red-500 px-1 text-[10px] font-medium text-white"
                style={{ top: (now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60) }}
              >
                {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {days.map((d) => {
              const today = sameDay(d, now);
              const nowTop =
                (now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60);
              return (
                <div
                  key={+d}
                  onDragOver={(e) => dragId && e.preventDefault()}
                  onDrop={(e) => {
                    const ev = events.find((x) => x.row.id === dragId);
                    if (ev) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const mins =
                        Math.round(((e.clientY - rect.top) / HOUR_PX) * 2) * 30;
                      reschedule(ev, new Date(+startOfDay(d) + mins * 60000));
                    }
                    setDragId(null);
                  }}
                  className="relative min-w-0 flex-1 border-l"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div
                      key={h}
                      style={{ height: HOUR_PX }}
                      className="border-b border-border/40"
                    />
                  ))}
                  {today && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                      style={{ top: nowTop }}
                    >
                      <span className="absolute -left-1 -top-1.5 size-2 rounded-full bg-red-500" />
                    </div>
                  )}
                  {eventsForDay(d).map((ev) => {
                    const top =
                      (ev.start.getHours() * 60 + ev.start.getMinutes()) *
                      (HOUR_PX / 60);
                    const dur = Math.max(
                      (ev.end.getTime() - ev.start.getTime()) / 60000,
                      30,
                    );
                    return (
                      <div
                        key={ev.row.id}
                        draggable={editable}
                        onDragStart={() => setDragId(ev.row.id)}
                        className="absolute inset-x-1 overflow-hidden rounded-md border border-primary/40 bg-primary/15 px-1 text-xs text-primary"
                        style={{ top, height: dur * (HOUR_PX / 60) }}
                        title={title(ev.row)}
                      >
                        <div className="truncate font-medium">{title(ev.row)}</div>
                        <div className="truncate text-[10px] opacity-80">
                          {ev.start.toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------- Month ----------
  function monthGrid() {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = mondayOf(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-7 border-b text-center text-xs text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
          {days.map((d) => {
            const inMonth = d.getMonth() === anchor.getMonth();
            const today = sameDay(d, now);
            const dayEvents = events.filter(
              (e) => startOfDay(e.start) <= d && startOfDay(e.end) >= d,
            );
            return (
              <div
                key={+d}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={() => {
                  const ev = events.find((x) => x.row.id === dragId);
                  if (ev) {
                    // keep time-of-day, change date.
                    const ns = new Date(d);
                    ns.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
                    reschedule(ev, ev.allDay ? startOfDay(d) : ns);
                  }
                  setDragId(null);
                }}
                className={`min-h-0 overflow-hidden border-b border-l p-1 ${
                  inMonth ? "" : "bg-muted/30"
                }`}
              >
                <div
                  className={`mb-0.5 text-right text-xs ${
                    today
                      ? "inline-flex size-5 items-center justify-center rounded-full bg-red-500 font-medium text-white"
                      : inMonth
                        ? ""
                        : "text-muted-foreground/50"
                  }`}
                >
                  {d.getDate()}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.row.id}
                      draggable={editable}
                      onDragStart={() => setDragId(ev.row.id)}
                      className="truncate rounded bg-primary/15 px-1 text-[11px] text-primary"
                      title={title(ev.row)}
                    >
                      {!ev.allDay &&
                        ev.start.toLocaleTimeString(undefined, {
                          hour: "numeric",
                        }) + " "}
                      {title(ev.row)}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div className="px-1 text-[10px] text-muted-foreground">
                      +{dayEvents.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- Year ----------
  function yearGrid() {
    const year = anchor.getFullYear();
    const eventDays = new Set(events.map((e) => ymd(startOfDay(e.start))));
    return (
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-4 overflow-auto pr-2">
        {Array.from({ length: 12 }, (_, mo) => {
          const first = new Date(year, mo, 1);
          const gridStart = mondayOf(first);
          const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
          return (
            <div key={mo}>
              <div className="mb-1 text-sm font-semibold text-red-500">
                {first.toLocaleDateString(undefined, { month: "long" })}
              </div>
              <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
                {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
                  <span key={i}>{w}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 text-center text-xs">
                {days.map((d) => {
                  const inMonth = d.getMonth() === mo;
                  const today = inMonth && sameDay(d, now);
                  const has = eventDays.has(ymd(d));
                  return (
                    <button
                      key={+d}
                      onClick={() => {
                        setAnchor(startOfDay(d));
                        setCalendarMode("day");
                      }}
                      className={`py-0.5 ${
                        today
                          ? "rounded-full bg-red-500 font-medium text-white"
                          : has && inMonth
                            ? "rounded-full bg-primary/15 font-medium text-primary"
                            : inMonth
                              ? "hover:bg-muted"
                              : "text-muted-foreground/40"
                      }`}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  let body: React.ReactNode;
  if (mode === "day") body = timeGrid([anchor]);
  else if (mode === "4days") body = timeGrid([0, 1, 2, 3].map((n) => addDays(anchor, n)));
  else if (mode === "week")
    body = timeGrid(Array.from({ length: 7 }, (_, i) => addDays(mondayOf(anchor), i)));
  else if (mode === "month") body = monthGrid();
  else body = yearGrid();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header()}
      {body}
    </div>
  );
}
