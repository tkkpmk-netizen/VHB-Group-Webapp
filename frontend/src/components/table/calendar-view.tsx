"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { looksDate } from "@/components/table/gantt-scale";
import { applyFilterTree, type FilterGroup } from "@/lib/view";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];
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
  entity: Entity;
  start: Date;
  end: Date;
  allDay: boolean;
  hasEnd: boolean;
};

type PositionedCalEvent = {
  event: CalEvent;
  lane: number;
  laneCount: number;
};

/** Pack overlapping timed events into side-by-side lanes without narrowing
 * unrelated events later in the same day. */
function positionTimedEvents(events: CalEvent[]): PositionedCalEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );
  const positioned: PositionedCalEvent[] = [];
  let cluster: Array<{ event: CalEvent; lane: number }> = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const laneCount = Math.max(1, ...cluster.map((item) => item.lane + 1));
    positioned.push(
      ...cluster.map((item) => ({ ...item, laneCount })),
    );
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const event of sorted) {
    const start = event.start.getTime();
    if (cluster.length && start >= clusterEnd) flush();
    const lane = laneEnds.findIndex((end) => end <= start);
    const nextLane = lane < 0 ? laneEnds.length : lane;
    laneEnds[nextLane] = event.end.getTime();
    clusterEnd = Math.max(clusterEnd, event.end.getTime());
    cluster.push({ event, lane: nextLane });
  }
  flush();
  return positioned;
}

function parseEvent(entity: Entity, fieldId: string): CalEvent | null {
  const v = (entity.data as Record<string, unknown>)[fieldId];
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
  return { entity, start: sp.d, end, allDay: sp.dateOnly, hasEnd };
}

export function CalendarView({
  databaseId,
  calendarField,
  setCalendarField,
  calendarMode,
  setCalendarMode,
  toolbarSlot,
  filterRoot,
  dataSourceId,
  filterToMatches,
  matchedIds,
  openEntity,
}: {
  databaseId: string;
  calendarField: string | null;
  setCalendarField: (id: string | null) => void;
  calendarMode: string;
  setCalendarMode: (m: string) => void;
  toolbarSlot: HTMLElement | null;
  filterRoot: FilterGroup;
  dataSourceId: string | null;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  openEntity: (entity: Entity) => void;
}) {
  const qc = useQueryClient();
  const [now] = useState(() => new Date());
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    title: string;
    value: { start: string; end: null };
    x: number;
    y: number;
  } | null>(null);
  const gridScroll = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const entitiesQ = useQuery<Entity[]>({
    queryKey: ["entities", databaseId, dataSourceId],
    queryFn: () =>
      apiFetch<Entity[]>(
        `/databases/${databaseId}/entities${dataSourceId ? `?data_source_id=${dataSourceId}` : ""}`,
      ),
  });
  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let entities = applyFilterTree(entitiesQ.data ?? [], byId, filterRoot);
  if (filterToMatches && matchedIds) entities = entities.filter((r) => matchedIds.has(r.id));

  const dateFields = fields.filter(
    (f) =>
      DATE_TYPES.has(f.type) ||
      (f.type === "formula" &&
        entities.some((r) => looksDate((r.data as Record<string, unknown>)[f.id]))),
  );
  const picked = calendarField ? byId[calendarField] : undefined;
  const field =
    (picked && dateFields.includes(picked) ? picked : undefined) ?? dateFields[0];
  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  const title = (r: Entity) => {
    const v = titleField ? (r.data as Record<string, unknown>)[titleField.id] : null;
    return typeof v === "string" && v ? v : r.uid;
  };
  const editable = field?.type === "date";

  const mode = (calendarMode as CalMode) ?? "month";
  const events = field
    ? entities.map((r) => parseEvent(r, field.id)).filter((e): e is CalEvent => !!e)
    : [];

  const save = useMutation({
    mutationFn: ({ entityId, value }: { entityId: string; value: unknown }) =>
      apiFetch<Entity>(`/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify({ data: { [field!.id]: value } }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entities", databaseId] }),
  });
  const createEvent = useMutation({
    mutationFn: (d: NonNullable<typeof draft>) => {
      const data: Record<string, unknown> = { [field!.id]: d.value };
      if (titleField) data[titleField.id] = d.title.trim() || null;
      return apiFetch<Entity>(`/databases/${databaseId}/entities`, {
        method: "POST",
        body: JSON.stringify({ name: d.title.trim(), data }),
      });
    },
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
    },
  });

  function openDraft(
    start: Date,
    anchor: { clientX: number; clientY: number },
    timed = false,
  ) {
    setDraft({
      title: "",
      value: { start: timed ? ymdhm(start) : ymd(start), end: null },
      x: anchor.clientX,
      y: anchor.clientY,
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.key.toLowerCase() !== "n" ||
        e.metaKey ||
        e.ctrlKey ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        !editable
      )
        return;
      e.preventDefault();
      openDraft(startOfDay(anchor), {
        clientX: window.innerWidth / 2,
        clientY: 160,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Move an event to a new start, keeping its duration. */
  function reschedule(ev: CalEvent, newStart: Date) {
    const dur = ev.end.getTime() - ev.start.getTime();
    const ne = new Date(newStart.getTime() + dur);
    const fmt = ev.allDay ? ymd : ymdhm;
    save.mutate({
      entityId: ev.entity.id,
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
        {toolbarSlot ? createPortal(header(), toolbarSlot) : header()}
        <div className="m-3 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Calendar cần một field ngày (Date / Created time / Last edited time / Formula
          ngày).
        </div>
      </div>
    );

  function header() {
    return (
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
        <button
          onClick={() => step(-1)}
          title="Previous period"
          className="flex size-6 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={() => step(1)}
          title="Next period"
          className="flex size-6 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
        <span className="flex h-6 min-w-24 items-center rounded-md border border-border/80 bg-background px-2 text-[11px] font-semibold">
          {headerTitle}
        </span>
        <button
          onClick={() => setAnchor(startOfDay(new Date()))}
          className="flex h-6 items-center rounded-md border border-border/80 bg-background px-2 text-[11px] font-medium hover:bg-muted"
        >
          Today
        </button>
        {dateFields.length > 1 && (
          <div className="w-32 shrink-0">
            <Dropdown
              value={field?.id ?? null}
              options={dateFields.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) => setCalendarField(v)}
              allowClear={false}
              compact
            />
          </div>
        )}
        <div className="w-20 shrink-0">
          <Dropdown
            value={mode}
            allowClear={false}
            options={MODES}
            onChange={(v) => v && setCalendarMode(v)}
            compact
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
        <div className="flex min-h-7 shrink-0 border-b">
          <div className="flex w-14 shrink-0 items-center justify-center text-[10px] text-muted-foreground">
            {tzLabel}
          </div>
          {days.map((d) => {
            const today = sameDay(d, now);
            return (
              <div key={+d} className="flex min-w-0 flex-1 items-center justify-center gap-1 py-0.5 text-xs">
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
        {/* All-day entity */}
        <div className="flex min-h-7 shrink-0 border-b">
          <div className="flex w-14 shrink-0 items-start justify-end py-1 pr-1.5 text-[10px] leading-4 text-muted-foreground">
            All day
          </div>
          {days.map((d) => (
            <div
              key={+d}
              onDragOver={(e) => dragId && e.preventDefault()}
              onDrop={() => {
                const ev = events.find((x) => x.entity.id === dragId);
                if (ev) reschedule(ev, startOfDay(d));
                setDragId(null);
              }}
              className="min-h-7 min-w-0 flex-1 space-y-0.5 border-l px-1 py-0.5"
            >
              {allDayForDay(d).map((ev) => (
                <div
                  key={ev.entity.id}
                  draggable={editable}
                  onDragStart={() => setDragId(ev.entity.id)}
                  onDoubleClick={() => openEntity(ev.entity)}
                  title={`${title(ev.entity)} · double-click to open`}
                  className="h-4 truncate rounded bg-primary/15 px-1 text-[10px] leading-4 text-primary"
                >
                  {title(ev.entity)}
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
                  onDoubleClick={(e) => {
                    if (!editable || (e.target as HTMLElement).closest("[draggable]"))
                      return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const mins =
                      Math.round(((e.clientY - rect.top) / HOUR_PX) * 2) * 30;
                    openDraft(
                      new Date(+startOfDay(d) + mins * 60000),
                      e,
                      true,
                    );
                  }}
                  onDragOver={(e) => dragId && e.preventDefault()}
                  onDrop={(e) => {
                    const ev = events.find((x) => x.entity.id === dragId);
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
                  {positionTimedEvents(eventsForDay(d)).map(({ event: ev, lane, laneCount }) => {
                    const top =
                      (ev.start.getHours() * 60 + ev.start.getMinutes()) *
                      (HOUR_PX / 60);
                    const dur = Math.max(
                      (ev.end.getTime() - ev.start.getTime()) / 60000,
                      30,
                    );
                    return (
                      <div
                        key={ev.entity.id}
                        draggable={editable}
                        onDragStart={() => setDragId(ev.entity.id)}
                        onDoubleClick={() => openEntity(ev.entity)}
                        className="absolute overflow-hidden rounded-md border border-primary/40 bg-primary/15 px-1 text-[11px] leading-4 text-primary"
                        style={{
                          top,
                          height: dur * (HOUR_PX / 60),
                          left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                          width: `calc(${100 / laneCount}% - 4px)`,
                        }}
                        title={`${title(ev.entity)} · double-click to open`}
                      >
                        <div className="truncate font-medium">{title(ev.entity)}</div>
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
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-entities-6">
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
                  const ev = events.find((x) => x.entity.id === dragId);
                  if (ev) {
                    // keep time-of-day, change date.
                    const ns = new Date(d);
                    ns.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
                    reschedule(ev, ev.allDay ? startOfDay(d) : ns);
                  }
                  setDragId(null);
                }}
                className={`group min-h-0 overflow-hidden border-b border-l p-1 ${
                  inMonth ? "" : "bg-muted/30"
                }`}
              >
                <div className="mb-0.5 flex items-center justify-between">
                  {editable && (
                    <button
                      onClick={(e) => openDraft(startOfDay(d), e)}
                      title={`Create on ${d.toLocaleDateString()}`}
                      className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                  <div
                    className={`ml-auto text-right text-xs ${
                      today
                        ? "inline-flex size-5 items-center justify-center rounded-full bg-red-500 font-medium text-white"
                        : inMonth
                          ? ""
                          : "text-muted-foreground/50"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.entity.id}
                      draggable={editable}
                      onDragStart={() => setDragId(ev.entity.id)}
                      className="truncate rounded bg-primary/15 px-1 text-[11px] text-primary"
                      title={title(ev.entity)}
                    >
                      {!ev.allDay &&
                        ev.start.toLocaleTimeString(undefined, {
                          hour: "numeric",
                        }) + " "}
                      {title(ev.entity)}
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
    <div className="relative flex h-full min-h-0 flex-col">
      <ViewQueryState
        loading={fieldsQ.isLoading || entitiesQ.isLoading}
        error={fieldsQ.isError || entitiesQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void entitiesQ.refetch();
        }}
      />
      {toolbarSlot ? createPortal(header(), toolbarSlot) : header()}
      {body}
      {draft &&
        createPortal(
          <>
            <button
              aria-label="Cancel new event"
              className="fixed inset-0 z-40"
              onClick={() => setDraft(null)}
            />
            <div
              className="fixed z-50 w-72 rounded-xl border bg-popover p-3 shadow-lg"
              style={{
                left:
                  typeof window === "undefined"
                    ? draft.x
                    : Math.max(8, Math.min(draft.x, window.innerWidth - 304)),
                top:
                  typeof window === "undefined"
                    ? draft.y
                    : Math.max(8, Math.min(draft.y, window.innerHeight - 132)),
              }}
            >
              <input
                autoFocus
                value={draft.title}
                onChange={(e) =>
                  setDraft((current) =>
                    current ? { ...current, title: e.target.value } : current,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.title.trim()) {
                    e.preventDefault();
                    createEvent.mutate(draft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setDraft(null);
                  }
                }}
                placeholder="Event name"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{draft.value.start.replace("T", " ")}</span>
                <span>Enter to save · Esc to cancel</span>
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
