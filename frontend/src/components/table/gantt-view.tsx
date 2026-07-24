"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LocateFixed,
  Plus,
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import { EntityNameDialog } from "@/components/table/entity-name-dialog";
import {
  PERIODS,
  applyDrag,
  looksDate,
  unitLabel,
  unitTicks,
  type GanttScale,
} from "@/components/table/gantt-scale";
import {
  applyFilterTree,
  applySorts,
  toText,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];

const DAY = 86_400_000;
const ROW_H = 40;
const HDR_H = 28; // each header row (two rows → 56px total)
const NAME_W = 200;
const COL_W = 130;
const ADD_W = 36;
const TITLE_KEY = "__title__";
const CHIP_TYPES = new Set(["select", "status", "priority", "country", "checkbox"]);

type Span = { start: number; end: number; allDay: boolean };

/** Parse one ISO date/datetime string as LOCAL time. dateOnly = no T part
 *  (date strings parsed via `new Date("Y-M-D")` would be UTC midnight → shifted). */
function parseLocal(s: string): { t: number; dateOnly: boolean } | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : { t: d.getTime(), dateOnly: false };
  }
  const [, y, mo, d, hh, mm] = m;
  if (hh != null)
    return { t: new Date(+y, +mo - 1, +d, +hh, +mm).getTime(), dateOnly: false };
  return { t: new Date(+y, +mo - 1, +d).getTime(), dateOnly: true };
}

/** A date cell ({start,end} or string) as a span. allDay (date-only, no time)
 *  renders 0h of the start date → 23h59 of the end date (whole days inclusive). */
function dateSpan(v: unknown): Span | null {
  let s: string | undefined;
  let e: string | null | undefined;
  if (typeof v === "string") s = v;
  else if (v && typeof v === "object") {
    const o = v as { start?: string; end?: string | null };
    s = o.start;
    e = o.end;
  }
  if (!s) return null;
  const sp = parseLocal(s);
  if (!sp) return null;
  let end = sp.t;
  if (e) {
    const ep = parseLocal(e);
    if (ep) end = ep.t;
  }
  return { start: sp.t, end: Math.max(end, sp.t), allDay: sp.dateOnly };
}

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Local YYYY-MM-DD (no TZ shift), for writing date-only cell values. */
const ymd = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Local YYYY-MM-DDTHH:mm, for writing date-time cell values (Hour period). */
const ymdhm = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ymd(t)}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const DATE_FORMATS = [
  { value: "locale", label: "Mặc định (bản địa)" },
  { value: "iso", label: "2026-01-31" },
  { value: "dmy", label: "31/01/2026" },
  { value: "mdy", label: "01/31/2026" },
  { value: "ymd", label: "2026/01/31" },
] as const;

/** Format an ISO date/datetime string per the chosen display format. */
function fmtDate(s: string, fmt: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d, hh, mm] = m;
  if (fmt === "locale") {
    const dt = new Date(s);
    return Number.isNaN(dt.getTime())
      ? s
      : hh != null
        ? dt.toLocaleString()
        : dt.toLocaleDateString();
  }
  let out =
    fmt === "dmy"
      ? `${d}/${mo}/${y}`
      : fmt === "mdy"
        ? `${mo}/${d}/${y}`
        : fmt === "ymd"
          ? `${y}/${mo}/${d}`
          : `${y}-${mo}-${d}`;
  if (hh != null && mm != null) out += ` ${hh}:${mm}`;
  return out;
}

// Field types whose value is always a date/timestamp the timeline can plot.
const DATE_TYPES = new Set(["date", "created_time", "last_edited_time"]);

/** Fields eligible as the timeline axis: date / created_time / last_edited_time,
 *  plus formula fields whose evaluated result looks like a date. */
function dateLikeFields(fields: Field[], entities: Entity[]): Field[] {
  return fields.filter((f) => {
    if (DATE_TYPES.has(f.type)) return true;
    if (f.type !== "formula") return false;
    return entities.some((r) => looksDate((r.data as Record<string, unknown>)[f.id]));
  });
}

export function GanttView({
  databaseId,
  ganttField,
  setGanttField,
  ganttScale,
  setGanttScale,
  ganttLeftFields,
  setGanttLeftFields,
  ganttColWidths,
  setGanttColWidths,
  ganttDateFormat,
  toolbarSlot,
  filterRoot,
  sorts,
  limit,
  dataSourceId,
  filterToMatches,
  matchedIds,
  openEntity,
}: {
  databaseId: string;
  ganttField: string | null;
  setGanttField: (id: string | null) => void;
  ganttScale: GanttScale | null;
  setGanttScale: (s: GanttScale) => void;
  ganttLeftFields: string[];
  setGanttLeftFields: (ids: string[]) => void;
  ganttColWidths: Record<string, number>;
  setGanttColWidths: (w: Record<string, number>) => void;
  ganttDateFormat: string;
  toolbarSlot: HTMLElement | null;
  filterRoot: FilterGroup;
  sorts: SortRule[];
  limit: number;
  dataSourceId: string | null;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  openEntity: (entity: Entity) => void;
}) {
  const qc = useQueryClient();
  const [now] = useState(() => Date.now()); // stable "today" marker for this mount
  const [pages, setPages] = useState(0); // entity "load more" clicks
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const [extBefore, setExtBefore] = useState(0); // window extensions (earlier)
  const [extAfter, setExtAfter] = useState(0); // window extensions (later)
  const [edges, setEdges] = useState({ left: false, right: false });
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(true);
  const [widths, setWidths] = useState<Record<string, number>>(() => ({
    ...ganttColWidths,
  }));
  // Live bar drag (move / resize an end). delta is in whole days.
  const [drag, setDrag] = useState<{
    entityId: string;
    mode: "move" | "start" | "end";
  } | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  // Unscheduled-tray hover/drag (set a date by clicking/dragging on the strip).
  const [trayHover, setTrayHover] = useState<{
    entityId: string;
    s: number;
    e: number;
  } | null>(null);
  const trayDrag = useRef<{ entityId: string; s: number; e: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trayScrollRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const didCenter = useRef(false);
  // Geometry mirrored into refs so the (stable) scroll-ref callback can read it.
  const leftWRef = useRef(0);
  const todayXRef = useRef(0);
  // Stable callback ref: never changes identity → the node attaches once and
  // scrollRef.current stays valid (no per-render detach/re-attach churn).
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    if (el && !didCenter.current) {
      el.scrollLeft = Math.max(0, todayXRef.current - (el.clientWidth - leftWRef.current) / 2);
      didCenter.current = true;
    }
  }, []);

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
  const save = useMutation({
    mutationFn: ({
      entityId,
      fieldId,
      value,
    }: {
      entityId: string;
      fieldId: string;
      value: unknown;
    }) =>
      apiFetch<Entity>(`/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify({ data: { [fieldId]: value } }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entities", databaseId] }),
  });
  const addEntity = useMutation({
    mutationFn: (name: string) =>
      apiFetch<Entity>(`/databases/${databaseId}/entities`, {
        method: "POST",
        body: JSON.stringify({ name, data: {} }),
      }),
    onSuccess: (created) => {
      setEditingEntityId(created.id);
      setNewEntityOpen(false);
      setPages(Math.floor((entitiesQ.data?.length ?? 0) / limit));
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
    },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.key.toLowerCase() !== "n" ||
        e.metaKey ||
        e.ctrlKey ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      e.preventDefault();
      setNewEntityOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let entities = applyFilterTree(entitiesQ.data ?? [], byId, filterRoot);
  if (filterToMatches && matchedIds) entities = entities.filter((r) => matchedIds.has(r.id));
  entities = applySorts(entities, byId, sorts);

  const dateFields = dateLikeFields(fields, entities);
  const picked = ganttField ? byId[ganttField] : undefined;
  const field =
    (picked && dateFields.includes(picked) ? picked : undefined) ?? dateFields[0];
  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  const title = (r: Entity) => {
    const v = titleField ? (r.data as Record<string, unknown>)[titleField.id] : null;
    return typeof v === "string" && v ? v : r.uid;
  };

  const period = ganttScale ?? "day";
  const P = PERIODS[period];

  // Resizable freeze-column widths (persisted to view config).
  const wOf = (key: string, def: number) => widths[key] ?? def;
  function startResize(key: string, startW: number, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) =>
      setWidths((w) => ({ ...w, [key]: Math.max(80, startW + ev.clientX - startX) }));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setWidths((w) => {
        setGanttColWidths(w);
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Extra freeze columns (besides Name + the date field).
  const extra = ganttLeftFields
    .map((id) => byId[id])
    .filter((f): f is Field => !!f && f.id !== field?.id && f.id !== titleField?.id);
  const addable = fields.filter(
    (f) =>
      f.id !== field?.id &&
      f.id !== titleField?.id &&
      !ganttLeftFields.includes(f.id),
  );
  const nameW = wOf(TITLE_KEY, NAME_W);
  const leftW =
    nameW +
    (field ? wOf(field.id, COL_W) : 0) +
    extra.reduce((s, f) => s + wOf(f.id, COL_W), 0) +
    (addable.length > 0 ? ADD_W : 0);

  function leftCell(f: Field, r: Entity) {
    const v = (r.data as Record<string, unknown>)[f.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    if (DATE_TYPES.has(f.type) || looksDate(v)) {
      const sp = dateSpan(v);
      if (sp) {
        const one = (t: number) => fmtDate(ymd(t), ganttDateFormat);
        return (
          <span>
            {one(sp.start)}
            {sp.end > sp.start ? ` → ${one(sp.end)}` : ""}
          </span>
        );
      }
    }
    if (CHIP_TYPES.has(f.type))
      return <ValueChip field={f} value={Array.isArray(v) ? v[0] : v} />;
    return <span className="truncate">{toText(f, v)}</span>;
  }

  const controls = (onToday?: () => void) => (
    <div className="flex items-center gap-1 whitespace-nowrap">
      {onToday && (
        <button
          onClick={onToday}
          className="flex h-6 items-center gap-1 rounded-md border border-border/80 bg-background px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <CalendarClock className="size-3" /> Today
        </button>
      )}
      {dateFields.length > 1 && (
        <div className="w-32 shrink-0" title="Timeline date field">
          <Dropdown
            value={field?.id ?? null}
            options={dateFields.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(v) => setGanttField(v)}
            allowClear={false}
            compact
          />
        </div>
      )}
      <div className="w-20 shrink-0" title="Timeline scale">
        <Dropdown
          value={period}
          options={(Object.keys(PERIODS) as GanttScale[]).map((k) => ({
            value: k,
            label: PERIODS[k].label,
          }))}
          onChange={(v) => v && setGanttScale(v as GanttScale)}
          allowClear={false}
          compact
        />
      </div>
    </div>
  );

  if (!field)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbarSlot ? (
          createPortal(controls(), toolbarSlot)
        ) : (
          <div className="mb-2">{controls()}</div>
        )}
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Timeline needs a date field: <b>Date</b>, <b>Created time</b>,{" "}
          <b>Last edited time</b>, or a date-returning <b>Formula</b>.
        </div>
      </div>
    );

  // Split dated entities (timeline) from undated ones (bottom tray).
  const allSpans = entities.map((r) => ({
    r,
    span: dateSpan((r.data as Record<string, unknown>)[field.id]),
  }));
  const datedAll = allSpans.filter(
    (x): x is { r: Entity; span: Span } => !!x.span,
  );
  const undatedEntities = allSpans.filter((x) => !x.span).map((x) => x.r);
  // Entity load limit (mirrors the table): render first N entities, reveal more.
  const shown = limit * (pages + 1);
  const entitySpans = datedAll.slice(0, shown);
  const hiddenCount = datedAll.length - entitySpans.length;

  // --- Time window: today ± windowDays, auto-grown to fit every LOADED bar so
  //     nothing is cut off. Loading more entities (below) extends it automatically.
  //     The side "More" buttons extend it further by one window each. ---
  const center = startOfDay(now);
  let domStart = center - (1 + extBefore) * P.windowDays * DAY;
  let domEnd = center + (1 + extAfter) * P.windowDays * DAY;
  for (const { span } of entitySpans) {
    domStart = Math.min(domStart, span.start);
    domEnd = Math.max(domEnd, span.end);
  }
  const pad = Math.max(3, Math.round(P.windowDays * 0.1)) * DAY;
  domStart = startOfDay(domStart) - pad;
  domEnd = startOfDay(domEnd) + pad;
  const dayPx = P.dayPx;
  // Drag/click snap unit: 15 minutes for the Hour period, 1 day otherwise.
  // Hover/click on the Hour period drops a 30-minute block by default.
  const snapMs = period === "hour" ? 15 * 60_000 : DAY;
  const snapPx = (dayPx * snapMs) / DAY;
  const blockMs = period === "hour" ? 30 * 60_000 : DAY;
  const width = ((domEnd - domStart) / DAY) * dayPx;
  const xOf = (t: number) => ((t - domStart) / DAY) * dayPx;

  const minor = unitTicks(domStart, domEnd, P.minor);
  const major = unitTicks(domStart, domEnd, P.major);
  const todayX = xOf(now);

  // Weekend shading only where individual days are wide enough to read.
  const weekends: number[] = [];
  if (period === "hour" || period === "day") {
    for (let t = startOfDay(domStart), g = 0; t <= domEnd && g < 400; t += DAY, g++) {
      const dow = new Date(t).getDay();
      if (dow === 0 || dow === 6) weekends.push(t);
    }
  }

  // Bars are editable only when the axis is a writable Date field (not
  // created_time / last_edited_time / formula, which are computed).
  const editable = field.type === "date";

  /** Begin a drag (move the block, or resize one end) on a bar. */
  function beginDrag(
    mode: "move" | "start" | "end",
    r: Entity,
    s: number,
    e: number,
    ev: React.MouseEvent,
  ) {
    if (!editable) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    setDrag({ entityId: r.id, mode });
    setDragDelta(0);
    const raw = (r.data as Record<string, unknown>)[field.id];
    const rawStart =
      typeof raw === "string"
        ? raw
        : ((raw as { start?: string })?.start ?? "");
    const hadEnd =
      typeof raw === "object" && raw != null && !!(raw as { end?: string }).end;
    const onMove = (m: MouseEvent) =>
      setDragDelta(Math.round((m.clientX - startX) / snapPx));
    const onUp = (m: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const dd = Math.round((m.clientX - startX) / snapPx);
      setDrag(null);
      setDragDelta(0);
      if (dd === 0) return;
      const { start: ns, end: ne } = applyDrag(mode, s, e, dd * snapMs);
      // Keep time precision when the period is Hour or the value already had one.
      const useTime = period === "hour" || rawStart.includes("T");
      const fmt = (t: number) => (useTime ? ymdhm(t) : ymd(t));
      const keepEnd = mode === "end" || hadEnd || ne !== ns;
      save.mutate({
        entityId: r.id,
        fieldId: field.id,
        value: { start: fmt(ns), end: keepEnd ? fmt(ne) : null },
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const scrollToX = (x: number) => {
    const el = scrollRef.current;
    if (!el) return;
    // Centre x within the VISIBLE timeline (viewport minus the frozen panel).
    el.scrollTo({
      left: Math.max(0, x - (el.clientWidth - leftW) / 2),
      behavior: "smooth",
    });
  };
  const scrollToToday = () => scrollToX(todayX);

  // Keep the tray's horizontal scroll in lockstep with the main timeline.
  const syncScroll = (from: HTMLElement, to: HTMLElement | null) => {
    if (!to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  // Snapped timestamp under the cursor inside a tray timeline entity
  // (hour for the Hour period, day otherwise).
  const trayDay = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = domStart + ((e.clientX - rect.left) / dayPx) * DAY;
    if (period === "hour") {
      const d = new Date(t);
      d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); // snap to 15 min
      return d.getTime();
    }
    return startOfDay(t);
  };
  function trayMove(entityId: string, e: React.MouseEvent) {
    if (!editable) return;
    const day = trayDay(e);
    const d = trayDrag.current;
    if (d && d.entityId === entityId) {
      d.e = day;
      setTrayHover({ entityId, s: d.s, e: day });
    } else if (!d) {
      setTrayHover({ entityId, s: day, e: day });
    }
  }
  function trayDown(entityId: string, e: React.MouseEvent) {
    if (!editable) return;
    e.preventDefault();
    const day = trayDay(e);
    trayDrag.current = { entityId, s: day, e: day };
    setTrayHover({ entityId, s: day, e: day });
    const onUp = () => {
      window.removeEventListener("mouseup", onUp);
      const d = trayDrag.current;
      trayDrag.current = null;
      setTrayHover(null);
      if (!d) return;
      const lo = Math.min(d.s, d.e);
      const hi = Math.max(d.s, d.e);
      const f = period === "hour" ? ymdhm : ymd;
      // Hour: a plain click drops a 30-min block; a drag uses the snapped range.
      const endT = period === "hour" ? (lo === hi ? lo + blockMs : hi) : lo === hi ? null : hi;
      save.mutate({
        entityId: d.entityId,
        fieldId: field.id,
        value: { start: f(lo), end: endT == null ? null : f(endT) },
      });
    };
    window.addEventListener("mouseup", onUp);
  }

  // Mirror geometry so the stable attachScroll callback can centre on mount.
  leftWRef.current = leftW;
  todayXRef.current = todayX;

  const hovDate = (t: number) =>
    period === "hour"
      ? fmtDate(ymdhm(t), ganttDateFormat)
      : fmtDate(ymd(t), ganttDateFormat);

  const colCls = "relative shrink-0 border-r px-3";
  const resizeHandle = (k: string, w: number) => (
    <span
      key={`rh-${k}`}
      onMouseDown={(e) => startResize(k, w, e)}
      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/40"
    />
  );

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
      {toolbarSlot ? (
        createPortal(controls(scrollToToday), toolbarSlot)
      ) : (
        <div className="mb-2">{controls(scrollToToday)}</div>
      )}
      <div
        ref={attachScroll}
        onScroll={(e) => {
          const el = e.currentTarget;
          syncScroll(el, trayScrollRef.current);
          const left = el.scrollLeft <= 2;
          const right = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
          // Only re-render when an edge flips — not on every scroll frame.
          setEdges((p) => (p.left === left && p.right === right ? p : { left, right }));
        }}
        className="min-h-0 flex-1 overflow-auto overscroll-x-none rounded-xl border [scrollbar-gutter:stable]"
      >
        <div className="flex" style={{ width: leftW + width }}>
          {/* Left: sticky frozen columns (Name + date field + extras) */}
          <div className="sticky left-0 z-30 shrink-0 bg-card" style={{ width: leftW }}>
            <div
              className="sticky top-0 z-10 flex items-stretch border-b bg-card text-xs font-medium text-muted-foreground"
              style={{ height: HDR_H * 2 }}
            >
              <div className={`${colCls} flex items-center`} style={{ width: nameW }}>
                {titleField?.name ?? "Name"}
                {resizeHandle(TITLE_KEY, nameW)}
              </div>
              <div
                className={`${colCls} flex items-center`}
                style={{ width: wOf(field.id, COL_W) }}
              >
                {field.name}
                {resizeHandle(field.id, wOf(field.id, COL_W))}
              </div>
              {extra.map((f) => (
                <div
                  key={f.id}
                  className={`${colCls} flex items-center justify-between gap-1`}
                  style={{ width: wOf(f.id, COL_W) }}
                >
                  <span className="truncate">{f.name}</span>
                  <button
                    onClick={() =>
                      setGanttLeftFields(ganttLeftFields.filter((id) => id !== f.id))
                    }
                    title="Remove column"
                    className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                  >
                    ×
                  </button>
                  {resizeHandle(f.id, wOf(f.id, COL_W))}
                </div>
              ))}
              {addable.length > 0 && (
                <div className="flex items-center justify-center border-r" style={{ width: ADD_W }}>
                  <Dropdown
                    value={null}
                    placeholder="+"
                    options={addable.map((f) => ({ value: f.id, label: f.name }))}
                    onChange={(v) => v && setGanttLeftFields([...ganttLeftFields, v])}
                  />
                </div>
              )}
            </div>
            {entitySpans.map(({ r, span }) => (
              <div
                key={r.id}
                className="group flex items-stretch border-b"
                style={{ height: ROW_H }}
              >
                <div
                  className={`${colCls} flex items-center gap-1 truncate text-sm font-medium`}
                  style={{ width: nameW }}
                  onDoubleClick={() => openEntity(r)}
                  title="Double-click to open entity"
                >
                  <span className="min-w-0 flex-1 truncate" title={title(r)}>
                    {titleField ? (
                      <CellEditor
                        key={editingEntityId === r.id ? "edit" : "view"}
                        field={titleField}
                        value={
                          (r.data as Record<string, unknown>)[titleField.id] ?? null
                        }
                        onCommit={(value) =>
                          save.mutate({
                            entityId: r.id,
                            fieldId: titleField.id,
                            value,
                          })
                        }
                        autoEdit={editingEntityId === r.id}
                        onFinish={() => setEditingEntityId(null)}
                      />
                    ) : (
                      title(r)
                    )}
                  </span>
                  {span && (
                    <button
                      onClick={() => scrollToX(xOf(span.start))}
                      title="Jump to time block"
                      className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition hover:bg-primary/10 hover:text-primary"
                    >
                      <LocateFixed className="size-3.5" />
                    </button>
                  )}
                </div>
                <div
                  className={`${colCls} flex items-center text-xs text-muted-foreground`}
                  style={{ width: wOf(field.id, COL_W) }}
                >
                  {leftCell(field, r)}
                </div>
                {extra.map((f) => (
                  <div
                    key={f.id}
                    className={`${colCls} flex items-center text-xs`}
                    style={{ width: wOf(f.id, COL_W) }}
                  >
                    {leftCell(f, r)}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Right: two-entity header + bars */}
          <div className="relative shrink-0" style={{ width }}>
            {/* Weekend shading (lowest layer) */}
            <div className="pointer-events-none absolute inset-y-0">
              {weekends.map((t) => (
                <div
                  key={t}
                  className="absolute inset-y-0 bg-muted/50"
                  style={{ left: xOf(t), width: dayPx }}
                />
              ))}
            </div>

            {/* Two-entity header (major group on top, minor columns below) */}
            <div className="sticky top-0 z-20 bg-card" style={{ height: HDR_H * 2 }}>
              {major.map((t, i) => (
                <div
                  key={`M${t}`}
                  className="absolute top-0 flex items-center border-l border-b px-2 text-xs font-semibold"
                  style={{
                    left: xOf(t),
                    width: xOf(major[i + 1] ?? domEnd) - xOf(t),
                    height: HDR_H,
                  }}
                >
                  <span className="truncate">{unitLabel(t, P.major, "major")}</span>
                </div>
              ))}
              {minor.map((t, i) => (
                <div
                  key={`m${t}`}
                  className="absolute flex items-center justify-center border-l border-b text-[11px] text-muted-foreground"
                  style={{
                    top: HDR_H,
                    left: xOf(t),
                    width: xOf(minor[i + 1] ?? domEnd) - xOf(t),
                    height: HDR_H,
                  }}
                >
                  <span className="truncate px-1">{unitLabel(t, P.minor, "minor")}</span>
                </div>
              ))}
            </div>

            {/* Minor gridlines spanning the body */}
            <div
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{ top: HDR_H * 2 }}
            >
              {minor.map((t) => (
                <div
                  key={t}
                  className="absolute bottom-0 top-0 border-l border-border/40"
                  style={{ left: xOf(t) }}
                />
              ))}
            </div>

            {entitySpans.map(({ r, span }) => {
              if (!span)
                return (
                  <div key={r.id} className="border-b" style={{ height: ROW_H }} />
                );
              const dragging = drag?.entityId === r.id;
              const dpx = dragging ? dragDelta * snapPx : 0;
              let left = xOf(span.start);
              // All-day: inclusive whole days (+1). Timed: exact duration.
              const dur = span.end - span.start;
              let w = span.allDay
                ? (dur / DAY + 1) * dayPx
                : Math.max((dur / DAY) * dayPx, 8);
              if (dragging) {
                if (drag.mode === "move") left += dpx;
                else if (drag.mode === "start") {
                  left += dpx;
                  w -= dpx;
                } else w += dpx;
                w = Math.max(w, dayPx * 0.5);
              }
              return (
                <div key={r.id} className="relative border-b" style={{ height: ROW_H }}>
                  <div
                    onMouseDown={(e) => beginDrag("move", r, span.start, span.end, e)}
                    className={`absolute top-1/2 flex -translate-y-1/2 items-center overflow-hidden rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground shadow-sm ${
                      editable ? "cursor-grab active:cursor-grabbing" : ""
                    } ${dragging ? "ring-2 ring-primary/40" : ""}`}
                    style={{ left, width: w, height: 22 }}
                    title={title(r)}
                  >
                    {editable && (
                      <span
                        onMouseDown={(e) => beginDrag("start", r, span.start, span.end, e)}
                        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/0 hover:bg-black/20"
                      />
                    )}
                    <span className="truncate">{title(r)}</span>
                    {editable && (
                      <span
                        onMouseDown={(e) => beginDrag("end", r, span.start, span.end, e)}
                        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/0 hover:bg-black/20"
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Current-time line (top layer) */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-20 border-l-2 border-red-500"
              style={{ left: todayX }}
            >
              <span className="absolute -left-[5px] top-[50px] size-2 rounded-full bg-red-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Window-extend buttons — only when scrolled hard against an edge. */}
      {edges.left && (
        <button
          onClick={() => setExtBefore((b) => b + 1)}
          className="absolute top-1/2 z-40 flex -translate-y-1/2 items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground shadow-md hover:bg-muted"
          style={{ left: leftW + 8 }}
        >
          <ChevronLeft className="size-3.5" /> More
        </button>
      )}
      {edges.right && (
        <button
          onClick={() => setExtAfter((a) => a + 1)}
          className="absolute right-3 top-1/2 z-40 flex -translate-y-1/2 items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs text-muted-foreground shadow-md hover:bg-muted"
        >
          More <ChevronRight className="size-3.5" />
        </button>
      )}

      <div className="mt-2 flex w-max items-center gap-2">
        {hiddenCount > 0 && (
          <button
            onClick={() => setPages((p) => p + 1)}
            className="flex items-center gap-1 rounded-md border px-3 py-1 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <ChevronDown className="size-4" /> Load more ({hiddenCount} left)
          </button>
        )}
        <button
          onClick={() => setNewEntityOpen(true)}
          title="Create a new entity and edit its name"
          className="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          <Plus className="size-4" /> New <kbd className="text-[10px] opacity-60">N</kbd>
        </button>
      </div>

      {/* Unscheduled tray: undated items, shares the timeline axis (no header). */}
      {undatedEntities.length > 0 && (
        <div className="mt-2 shrink-0 overflow-hidden rounded-xl border">
          <button
            type="button"
            onClick={() => setUnscheduledOpen((open) => !open)}
            aria-expanded={unscheduledOpen}
            className={`flex h-7 w-full items-center gap-1.5 bg-muted/30 px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 ${
              unscheduledOpen ? "border-b" : ""
            }`}
          >
            <ChevronDown
              className={`size-3 transition-transform ${unscheduledOpen ? "" : "-rotate-90"}`}
            />
            <span>Unscheduled ({undatedEntities.length})</span>
            <span className="truncate font-normal opacity-70">
              {editable
                ? "Click or drag on the timeline to set a date"
                : "This field cannot be edited"}
            </span>
          </button>
          {unscheduledOpen && (
            <div
              ref={trayScrollRef}
              onScroll={(e) => syncScroll(e.currentTarget, scrollRef.current)}
              className="overflow-auto overscroll-x-none"
              style={{ maxHeight: ROW_H * 5 }}
            >
            <div className="flex" style={{ width: leftW + width }}>
              {/* Left sticky columns (match the main panel widths) */}
              <div className="sticky left-0 z-20 shrink-0 bg-card" style={{ width: leftW }}>
                {undatedEntities.map((r) => {
                  const hov = trayHover?.entityId === r.id ? trayHover : null;
                  return (
                    <div
                      key={r.id}
                      className="flex items-stretch border-b"
                      style={{ height: ROW_H }}
                    >
                      <div
                        className={`${colCls} flex items-center truncate text-sm font-medium`}
                        style={{ width: nameW }}
                        title={title(r)}
                      >
                        {titleField ? (
                          <CellEditor
                            key={editingEntityId === r.id ? "edit" : "view"}
                            field={titleField}
                            value={
                              (r.data as Record<string, unknown>)[titleField.id] ??
                              null
                            }
                            onCommit={(value) =>
                              save.mutate({
                                entityId: r.id,
                                fieldId: titleField.id,
                                value,
                              })
                            }
                            autoEdit={editingEntityId === r.id}
                            onFinish={() => setEditingEntityId(null)}
                          />
                        ) : (
                          title(r)
                        )}
                      </div>
                      <div
                        className={`${colCls} flex items-center text-xs ${
                          hov ? "font-medium text-primary" : "text-muted-foreground"
                        }`}
                        style={{ width: wOf(field.id, COL_W) }}
                      >
                        {hov
                          ? `${hovDate(Math.min(hov.s, hov.e))}${
                              hov.s !== hov.e
                                ? ` → ${hovDate(Math.max(hov.s, hov.e))}`
                                : ""
                            }`
                          : leftCell(field, r)}
                      </div>
                      {extra.map((f) => (
                        <div
                          key={f.id}
                          className={`${colCls} flex items-center text-xs`}
                          style={{ width: wOf(f.id, COL_W) }}
                        >
                          {leftCell(f, r)}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Right strip: gridlines + per-entity hover/drag to set a date */}
              <div className="relative shrink-0" style={{ width }}>
                <div className="pointer-events-none absolute inset-0">
                  {minor.map((t) => (
                    <div
                      key={t}
                      className="absolute bottom-0 top-0 border-l border-border/40"
                      style={{ left: xOf(t) }}
                    />
                  ))}
                  <div
                    className="absolute bottom-0 top-0 border-l-2 border-red-500/70"
                    style={{ left: todayX }}
                  />
                </div>
                {undatedEntities.map((r) => {
                  const hov = trayHover?.entityId === r.id ? trayHover : null;
                  const lo = hov ? Math.min(hov.s, hov.e) : 0;
                  const hiRaw = hov ? Math.max(hov.s, hov.e) : 0;
                  // Block end: 30-min default for an hour single, inclusive day otherwise.
                  const hiEnd =
                    period === "hour"
                      ? lo === hiRaw
                        ? lo + blockMs
                        : hiRaw
                      : hiRaw + DAY;
                  return (
                    <div
                      key={r.id}
                      onMouseMove={(e) => trayMove(r.id, e)}
                      onMouseDown={(e) => trayDown(r.id, e)}
                      onMouseLeave={() => {
                        if (!trayDrag.current) setTrayHover(null);
                      }}
                      className={`relative border-b ${editable ? "cursor-pointer" : ""}`}
                      style={{ height: ROW_H }}
                    >
                      {hov && (
                        <div
                          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-md border border-dashed border-primary bg-primary/25"
                          style={{
                            left: xOf(lo),
                            width: Math.max(((hiEnd - lo) / DAY) * dayPx, 6),
                            height: 22,
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          )}
        </div>
      )}
      <EntityNameDialog
        open={newEntityOpen}
        pending={addEntity.isPending}
        onClose={() => setNewEntityOpen(false)}
        onCreate={(name) => addEntity.mutate(name)}
      />
    </div>
  );
}
