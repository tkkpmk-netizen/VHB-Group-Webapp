"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import { ColumnMenu } from "@/components/table/column-menu";
import { Dropdown } from "@/components/ui/dropdown";
import { countryByCode, parsePhone } from "@/lib/countries";
import { applyFilterTree, applySorts, groupRows } from "@/lib/view";
import type { SharedViewProps } from "@/components/table/view-shell";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];
type RowPage = components["schemas"]["RowPage"];
type Db = components["schemas"]["DatabaseOut"];

const FIELD_TYPES: { value: string; label: string; choices: boolean }[] = [
  { value: "text", label: "Text", choices: false },
  { value: "long_text", label: "Long text", choices: false },
  { value: "number", label: "Number", choices: false },
  { value: "checkbox", label: "Checkbox", choices: false },
  { value: "date", label: "Date", choices: false },
  { value: "url", label: "URL", choices: false },
  { value: "email", label: "Email", choices: false },
  { value: "phone", label: "Phone", choices: false },
  { value: "country", label: "Country", choices: false },
  { value: "files", label: "Files & media", choices: false },
  { value: "relation", label: "Relation", choices: false },
  { value: "rollup", label: "Rollup", choices: false },
  { value: "formula", label: "Formula", choices: false },
  { value: "people", label: "People", choices: false },
  { value: "progress", label: "Progress", choices: false },
  { value: "created_time", label: "Created time", choices: false },
  { value: "created_by", label: "Created by", choices: false },
  { value: "last_edited_time", label: "Last edited time", choices: false },
  { value: "last_edited_by", label: "Last edited by", choices: false },
  { value: "select", label: "Select", choices: true },
  { value: "multi_select", label: "Multi-select", choices: true },
  { value: "status", label: "Status", choices: true },
  { value: "priority", label: "Priority", choices: true },
  { value: "rating", label: "Rating (1-5)", choices: false },
];

const NUM_TYPES = new Set(["number", "rating"]);

function calcOptions(type: string) {
  const base = [
    { value: "", label: "None" },
    { value: "count", label: "Count all" },
    { value: "filled", label: "Filled" },
    { value: "empty", label: "Empty" },
    { value: "unique", label: "Unique" },
    { value: "percent_filled", label: "% Filled" },
  ];
  if (NUM_TYPES.has(type))
    return [
      ...base,
      { value: "sum", label: "Sum" },
      { value: "avg", label: "Average" },
      { value: "min", label: "Min" },
      { value: "max", label: "Max" },
    ];
  return base;
}

function isEmptyVal(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

function computeCalc(field: Field, rows: Row[], op: string): string {
  if (!op) return "";
  const vals = rows.map((r) => (r.data as Record<string, unknown>)[field.id]);
  const filled = vals.filter((v) => !isEmptyVal(v));
  if (op === "count") return String(rows.length);
  if (op === "filled") return String(filled.length);
  if (op === "empty") return String(rows.length - filled.length);
  if (op === "unique")
    return String(new Set(filled.map((v) => JSON.stringify(v))).size);
  if (op === "percent_filled")
    return rows.length
      ? `${Math.round((filled.length / rows.length) * 100)}%`
      : "0%";
  const nums = filled
    .map((v) => Number(v))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return "—";
  if (op === "sum") return nums.reduce((a, b) => a + b, 0).toLocaleString("en-US");
  if (op === "avg")
    return (nums.reduce((a, b) => a + b, 0) / nums.length).toLocaleString("en-US", {
      maximumFractionDigits: 2,
    });
  if (op === "min") return String(Math.min(...nums));
  if (op === "max") return String(Math.max(...nums));
  return "";
}

/** "Bulk" control next to New: enter a count (≤100) to add that many rows. */
function BulkAddRows({
  onAdd,
  disabled,
}: {
  onAdd: (n: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(10);
  if (!open)
    return (
      <button
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Add multiple rows"
        className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <ChevronDown className="size-3.5" /> Bulk
      </button>
    );
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        min={1}
        max={100}
        value={n}
        autoFocus
        onChange={(e) => setN(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onAdd(n);
            setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-16 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        onClick={() => {
          onAdd(n);
          setOpen(false);
        }}
        className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Add
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-muted"
      >
        ✕
      </button>
    </span>
  );
}

function slug(label: string, i: number): string {
  const s = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || `opt-${i}`;
}

function buildOptions(
  type: string,
  choicesStr: string,
  format: string,
  currency: string,
): Record<string, unknown> {
  const meta = FIELD_TYPES.find((t) => t.value === type);
  if (meta?.choices) {
    return {
      choices: choicesStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label, i) => ({ id: slug(label, i), label })),
    };
  }
  if (type === "number") {
    return {
      format,
      ...(format === "currency" ? { currency_code: currency.trim() || "VND" } : {}),
      ...(format === "decimal" ? { precision: 2 } : {}),
    };
  }
  return {};
}


export function TableView({
  databaseId,
  filterRoot,
  setFilterRoot,
  sorts,
  setSorts,
  groupFieldId,
  setGroupFieldId,
  hideEmpty,
  frozenUpTo,
  setFrozenUpTo,
  calc,
  setCalc,
  hidden,
  limit,
  search,
  filterToMatches,
  matchedIds,
  flashId,
}: { databaseId: string } & SharedViewProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [menu, setMenu] = useState<{ field: Field; x: number; y: number } | null>(
    null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editCell, setEditCell] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childShown, setChildShown] = useState<Record<string, number>>({}); // per-parent sub-item window
  const [resizing, setResizing] = useState<{
    fieldId: string;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState("text");
  const [fOptions, setFOptions] = useState("");
  const [fFormat, setFFormat] = useState("integer");
  const [fCurrency, setFCurrency] = useState("VND");
  const [fTargetDb, setFTargetDb] = useState<string | null>(null);
  const [fTwoWay, setFTwoWay] = useState(false);

  // Databases list — only used to pick a relation field's target database.
  const dbQ = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const pageSize = Math.min(Math.max(limit, 1), 200);
  const rowsQueryKey = ["rows", databaseId, "infinite", pageSize] as const;
  const rowsQ = useInfiniteQuery<RowPage>({
    queryKey: rowsQueryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<RowPage>(`/databases/${databaseId}/rows/query`, {
        method: "POST",
        body: JSON.stringify({ page: pageParam, page_size: pageSize }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined,
  });
  const rowItems = useMemo(
    () => rowsQ.data?.pages.flatMap((page) => page.items) ?? [],
    [rowsQ.data?.pages],
  );
  const totalRows = rowsQ.data?.pages[0]?.total ?? 0;

  function updateCachedRows(
    transform: (rows: Row[]) => Row[],
    totalDelta = 0,
  ) {
    qc.setQueryData<InfiniteData<RowPage>>(rowsQueryKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => {
          const total = Math.max(0, page.total + totalDelta);
          return {
            ...page,
            total,
            pages: Math.ceil(total / page.page_size),
            items: transform(page.items),
          };
        }),
      };
    });
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fields", databaseId] });
    qc.invalidateQueries({ queryKey: ["rows", databaseId] });
  };

  const addField = useMutation({
    mutationFn: () => {
      const options =
        fType === "relation"
          ? { target_database_id: fTargetDb, two_way: fTwoWay }
          : buildOptions(fType, fOptions, fFormat, fCurrency);
      return apiFetch<Field>(`/databases/${databaseId}/fields`, {
        method: "POST",
        body: JSON.stringify({ name: fName.trim(), type: fType, options }),
      });
    },
    onSuccess: () => {
      setAdding(false);
      setFName("");
      setFType("text");
      setFOptions("");
      setFFormat("integer");
      setFCurrency("VND");
      setFTargetDb(null);
      setFTwoWay(false);
      invalidate();
    },
  });

  const addRow = useMutation({
    mutationFn: () =>
      apiFetch<Row>(`/databases/${databaseId}/rows`, {
        method: "POST",
        body: JSON.stringify({ data: {} }),
      }),
    onSuccess: (created) => {
      const title = (fieldsQ.data ?? []).find((f) =>
        ["text", "long_text"].includes(f.type),
      );
      if (title) setEditCell(`${created.id}:${title.id}`);
      invalidate();
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
      addRow.mutate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const bulkAdd = useMutation({
    mutationFn: (count: number) =>
      apiFetch<Row[]>(`/databases/${databaseId}/rows/bulk`, {
        method: "POST",
        body: JSON.stringify({ count }),
      }),
    onSuccess: invalidate,
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/rows/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      updateCachedRows((rows) => rows.filter((row) => row.id !== id), -1);
      qc.invalidateQueries({ queryKey: ["rows-search", databaseId] });
    },
  });

  const updateCell = useMutation({
    mutationFn: ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) =>
      apiFetch<Row>(`/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: (updated) => {
      updateCachedRows((rows) =>
        rows.map((row) => (row.id === updated.id ? updated : row)),
      );
      qc.invalidateQueries({ queryKey: ["rows-search", databaseId] });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => apiFetch<void>(`/rows/${id}`, { method: "DELETE" })),
      );
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["rows", databaseId] });
    },
  });

  const duplicateRows = useMutation({
    mutationFn: async (ids: string[]) => {
      const byId = new Map(rowItems.map((r) => [r.id, r.data]));
      for (const id of ids) {
        await apiFetch<Row>(`/databases/${databaseId}/rows`, {
          method: "POST",
          body: JSON.stringify({ data: byId.get(id) ?? {} }),
        });
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["rows", databaseId] });
    },
  });

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const updateWidth = useMutation({
    mutationFn: ({ field, width }: { field: Field; width: number }) =>
      apiFetch<Field>(`/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: field.name,
          options: { ...(field.options as object), width },
        }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });

  // Column resize drag handling.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) =>
      setResizing((r) =>
        r
          ? { ...r, width: Math.max(80, r.startWidth + e.clientX - r.startX) }
          : r,
      );
    const onUp = () =>
      setResizing((r) => {
        if (r) {
          const f = (fieldsQ.data ?? []).find((x) => x.id === r.fieldId);
          if (f) updateWidth.mutate({ field: f, width: r.width });
        }
        return null;
      });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing?.fieldId]);

  function colWidth(f: Field): number {
    if (resizing?.fieldId === f.id) return resizing.width;
    const w = (f.options as { width?: number })?.width;
    return typeof w === "number" ? w : 200;
  }

  // Sticky offsets for frozen (pinned) leftmost columns.
  function frozenStyle(colIdx: number): React.CSSProperties | undefined {
    if (colIdx > frozenUpTo) return undefined;
    const list = (fieldsQ.data ?? []).filter((f) => !hidden.has(f.id));
    let left = 40; // checkbox column width
    for (let i = 0; i < colIdx; i++) left += colWidth(list[i]);
    return {
      position: "sticky",
      left,
      zIndex: 2,
      background: "var(--color-card)",
    };
  }
  const checkboxFrozen: React.CSSProperties | undefined =
    frozenUpTo >= 0
      ? { position: "sticky", left: 0, zIndex: 3, background: "var(--color-card)" }
      : undefined;

  function handleRowClick(idx: number, id: string, shift: boolean) {
    const rs = rowItems;
    if (shift && anchor !== null) {
      const [lo, hi] = anchor <= idx ? [anchor, idx] : [idx, anchor];
      setSelected(new Set(rs.slice(lo, hi + 1).map((r) => r.id)));
      setCursor(idx);
    } else {
      toggleRow(id);
      setAnchor(idx);
      setCursor(idx);
    }
  }

  // Ctrl/Cmd+Shift+Down/Up extends row selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const rs = rowItems;
      if (!rs.length) return;
      const a = anchor ?? 0;
      const cur = cursor ?? a;
      const c =
        e.key === "ArrowDown"
          ? Math.min(cur + 1, rs.length - 1)
          : Math.max(cur - 1, 0);
      const [lo, hi] = a <= c ? [a, c] : [c, a];
      setAnchor(a);
      setCursor(c);
      setSelected(new Set(rs.slice(lo, hi + 1).map((r) => r.id)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchor, cursor, rowItems]);

  const reorderFields = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/fields/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });

  const reorderRows = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/rows/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows", databaseId] }),
  });

  async function insertField(side: "left" | "right", targetId: string) {
    const created = await apiFetch<Field>(`/databases/${databaseId}/fields`, {
      method: "POST",
      body: JSON.stringify({ name: "Untitled", type: "text", options: {} }),
    });
    const ids = (fieldsQ.data ?? [])
      .map((f) => f.id)
      .filter((id) => id !== created.id);
    const tIdx = ids.indexOf(targetId);
    ids.splice(side === "left" ? tIdx : tIdx + 1, 0, created.id);
    await apiFetch<void>(`/databases/${databaseId}/fields/reorder`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    qc.invalidateQueries({ queryKey: ["fields", databaseId] });
  }

  function moveBefore(ids: string[], fromId: string, toId: string): string[] {
    if (fromId === toId) return ids;
    const arr = ids.filter((i) => i !== fromId);
    const to = arr.indexOf(toId);
    arr.splice(to < 0 ? arr.length : to, 0, fromId);
    return arr;
  }

  const fields = fieldsQ.data ?? [];
  const rows = rowItems;
  const choiceType = ["select", "multi_select"].includes(fType);

  // View tools: filter → sort → search → optional group.
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let visible = applySorts(
    applyFilterTree(rows, byId, filterRoot),
    byId,
    sorts,
  );
  const searchActive = search.trim().length > 0;
  if (searchActive && filterToMatches && matchedIds)
    visible = visible.filter((r) => matchedIds.has(r.id));
  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupRows(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");
  const displayFields = fields.filter((f) => !hidden.has(f.id));
  const calcFields = displayFields.filter((f) => calc[f.id]);
  const subOwner = fields.find(
    (f) =>
      (f.options as { sub_item?: boolean; mirror?: boolean })?.sub_item &&
      !(f.options as { mirror?: boolean })?.mirror,
  );
  const subParent = fields.find(
    (f) =>
      (f.options as { sub_item?: boolean; mirror?: boolean })?.sub_item &&
      (f.options as { mirror?: boolean })?.mirror,
  );
  // Hierarchy mode: when sub-items on and not grouping, show a parent→child tree.
  const treeMode = !!subOwner && !!subParent && !groups;
  const rowById = new Map(visible.map((r) => [r.id, r]));
  const childrenOf = (row: Row): Row[] => {
    if (!subOwner) return [];
    const ids = (row.data as Record<string, unknown>)[subOwner.id];
    return Array.isArray(ids)
      ? ids.map((id) => rowById.get(String(id))).filter((r): r is Row => !!r)
      : [];
  };
  const topLevel = treeMode
    ? visible.filter((r) => {
        const p = (r.data as Record<string, unknown>)[subParent!.id];
        return !Array.isArray(p) || p.length === 0;
      })
    : visible;

  async function addSubRow(parent: Row) {
    if (!subOwner) return;
    const child = await apiFetch<Row>(`/databases/${databaseId}/rows`, {
      method: "POST",
      body: JSON.stringify({ data: {} }),
    });
    const cur = ((parent.data as Record<string, unknown>)[subOwner.id] ??
      []) as string[];
    await apiFetch<Row>(`/rows/${parent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { [subOwner.id]: [...cur, child.id] } }),
    });
    setExpanded((p) => new Set(p).add(parent.id));
    qc.invalidateQueries({ queryKey: ["rows", databaseId] });
  }

  // Commit a cell; setting a Country auto-fills phone dial codes in the row.
  function commitCell(row: Row, field: Field, value: unknown) {
    const data: Record<string, unknown> = { [field.id]: value };
    if (field.type === "country" && typeof value === "string" && value) {
      const c = countryByCode(value);
      if (c) {
        for (const f of fields) {
          if (f.type !== "phone") continue;
          const cur = (row.data as Record<string, unknown>)[f.id];
          const number = parsePhone(typeof cur === "string" ? cur : "").number;
          data[f.id] = `+${c.dial}${number ? " " + number : ""}`;
        }
      }
    }
    updateCell.mutate({ rowId: row.id, data });
  }

  // --- Excel-style cell range selection ---
  const [range, setRange] = useState<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  // True if the cell about to be clicked was already the sole-selected cell
  // (captured on mousedown, before the td re-selects it) → second click edits.
  const clickedActive = useRef(false);

  function isActiveCell(r: number, c: number): boolean {
    return (
      !!range && range.r1 === r && range.r2 === r && range.c1 === c && range.c2 === c
    );
  }

  function inRange(r: number, c: number): boolean {
    if (!range) return false;
    const [r1, r2] = [Math.min(range.r1, range.r2), Math.max(range.r1, range.r2)];
    const [c1, c2] = [Math.min(range.c1, range.c2), Math.max(range.c1, range.c2)];
    return r >= r1 && r <= r2 && c >= c1 && c <= c2;
  }

  function cellText(f: Field, row: Row): string {
    if (f.type === "unique_id") {
      const prefix = (f.options as { prefix?: string })?.prefix ?? "";
      return `${prefix}${row.seq}`;
    }
    const v = (row.data as Record<string, unknown>)[f.id];
    if (v === null || v === undefined) return "";
    if (f.type === "checkbox") return v === true ? "TRUE" : "";
    const choices =
      (f.options as { choices?: { id: string; label: string }[] })?.choices ?? [];
    const labelOf = (id: string) =>
      choices.find((c) => c.id === id)?.label ?? id;
    if (["select", "status", "priority"].includes(f.type))
      return labelOf(String(v));
    if (f.type === "multi_select" && Array.isArray(v))
      return v.map((x) => labelOf(String(x))).join(", ");
    return String(v);
  }

  useEffect(() => {
    const onUp = () => setDragging(false);
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      if (e.key === "Escape") {
        setRange(null);
        setEditCell(null);
        return;
      }
      if (range) {
        const row = range.r2;
        const col = range.c2;
        const move =
          e.key === "ArrowDown"
            ? [1, 0]
            : e.key === "ArrowUp"
              ? [-1, 0]
              : e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)
                ? [0, 1]
                : e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)
                  ? [0, -1]
                  : null;
        if (move) {
          e.preventDefault();
          const nr = Math.max(0, Math.min(visible.length - 1, row + move[0]));
          const nc = Math.max(
            0,
            Math.min(displayFields.length - 1, col + move[1]),
          );
          setRange({ r1: nr, c1: nc, r2: nr, c2: nc });
          setEditCell(null);
          return;
        }
        if (e.key === "Enter") {
          const r = visible[row];
          const f = displayFields[col];
          if (r && f && f.type !== "unique_id") {
            e.preventDefault();
            setEditCell(`${r.id}:${f.id}`);
          }
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && range) {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        const rs = rowItems;
        const fs = fieldsQ.data ?? [];
        const [r1, r2] = [
          Math.min(range.r1, range.r2),
          Math.max(range.r1, range.r2),
        ];
        const [c1, c2] = [
          Math.min(range.c1, range.c2),
          Math.max(range.c1, range.c2),
        ];
        const tsv = rs
          .slice(r1, r2 + 1)
          .map((row) =>
            fs
              .slice(c1, c2 + 1)
              .map((f) => cellText(f, row))
              .join("\t"),
          )
          .join("\n");
        void navigator.clipboard?.writeText(tsv);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [range, rowItems, fieldsQ.data, visible, displayFields]);

  function finishCell(
    rowIdx: number,
    colIdx: number,
    move?: "down" | "next" | "previous",
  ) {
    setEditCell(null);
    if (!move || visible.length === 0 || displayFields.length === 0) return;
    let nr = rowIdx;
    let nc = colIdx;
    if (move === "down") nr = Math.min(visible.length - 1, rowIdx + 1);
    else if (move === "next") {
      nc += 1;
      if (nc >= displayFields.length) {
        nc = 0;
        nr = Math.min(visible.length - 1, rowIdx + 1);
      }
    } else {
      nc -= 1;
      if (nc < 0) {
        nc = displayFields.length - 1;
        nr = Math.max(0, rowIdx - 1);
      }
    }
    setRange({ r1: nr, c1: nc, r2: nr, c2: nc });
  }

  function toggleExpand(id: string) {
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function renderRow(row: Row, idx: number, depth = 0) {
    const kids = childrenOf(row);
    const isOpen = expanded.has(row.id);
    return (
      <tr
        key={row.id}
        data-row-id={row.id}
        onDragOver={(e) => dragRowId && e.preventDefault()}
        onDrop={() => {
          if (dragRowId) {
            reorderRows.mutate(
              moveBefore(rows.map((r) => r.id), dragRowId, row.id),
            );
            setDragRowId(null);
          }
        }}
        className={`group border-b last:border-0 transition-colors ${
          flashId === row.id
            ? "bg-primary/20"
            : searchActive && !filterToMatches && matchedIds?.has(row.id)
              ? "bg-primary/5"
              : selected.has(row.id)
                ? "bg-accent/30"
                : ""
        }`}
      >
        <td
          className="whitespace-nowrap bg-card px-2 text-center"
          style={checkboxFrozen}
        >
          <span
            draggable
            onDragStart={() => setDragRowId(row.id)}
            title="Drag to reorder row"
            className="mr-1 inline-block cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="inline size-3.5" />
          </span>
          <input
            type="checkbox"
            checked={selected.has(row.id)}
            onChange={() => {}}
            onClick={(e) => handleRowClick(idx, row.id, e.shiftKey)}
            className="size-4 align-middle accent-[var(--color-primary)]"
          />
        </td>
        {displayFields.map((f, colIdx) => {
          const cellKey = `${row.id}:${f.id}`;
          const isEditing = editCell === cellKey;
          return (
            <td
              key={f.id}
              onMouseDown={() => {
                if (isEditing) return; // editing this cell: let the input handle it
                setEditCell(null);
                setRange({ r1: idx, c1: colIdx, r2: idx, c2: colIdx });
                setDragging(true);
              }}
              onMouseEnter={() => {
                if (dragging)
                  setRange((r) => (r ? { ...r, r2: idx, c2: colIdx } : r));
              }}
              style={frozenStyle(colIdx)}
              className={`overflow-hidden border-r px-1 align-middle ${
                inRange(idx, colIdx) ? "bg-primary/10" : "bg-card"
              }`}
            >
              <div
                className="flex items-center"
                style={treeMode && colIdx === 0 ? { paddingLeft: depth * 18 } : undefined}
              >
                {treeMode && colIdx === 0 && (
                  <>
                    <button
                      onClick={() => kids.length && toggleExpand(row.id)}
                      className={`mr-0.5 shrink-0 ${kids.length ? "text-muted-foreground hover:text-foreground" : "invisible"}`}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => addSubRow(row)}
                      title="Add sub-item"
                      className="mr-1 shrink-0 text-muted-foreground opacity-0 hover:text-primary group-hover:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </>
                )}
                <div className="relative min-w-0 flex-1">
                  {f.type === "unique_id" ? (
                    <span className="px-2 text-sm text-muted-foreground">
                      {((f.options as { prefix?: string })?.prefix ?? "") + row.seq}
                    </span>
                  ) : (
                    <CellEditor
                      key={isEditing ? "edit" : "view"}
                      field={f}
                      databaseId={databaseId}
                      rowId={row.id}
                      value={(row.data as Record<string, unknown>)[f.id] ?? null}
                      onCommit={(v) => commitCell(row, f, v)}
                      autoEdit={isEditing}
                      onFinish={(move) => finishCell(idx, colIdx, move)}
                    />
                  )}
                  {/* 1st click selects; click on the already-selected cell or
                      double-click enters edit (dropdowns auto-open via autoEdit). */}
                  {!isEditing && f.type !== "unique_id" && f.type !== "files" && (
                    <div
                      className="absolute inset-0 z-[1] cursor-cell"
                      onMouseDown={() => {
                        clickedActive.current = isActiveCell(idx, colIdx);
                      }}
                      onClick={() => {
                        if (clickedActive.current) setEditCell(cellKey);
                      }}
                      onDoubleClick={() => setEditCell(cellKey)}
                    />
                  )}
                </div>
              </div>
            </td>
          );
        })}
        <td className="whitespace-nowrap px-2 text-center">
          <button
            onClick={() => deleteRow.mutate(row.id)}
            title="Delete row"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="inline size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </td>
      </tr>
    );
  }

  // Recursive render for tree (sub-item) mode. Each parent shows up to 5
  // children at a time with a "Load more sub-items" row.
  const CHILD_PAGE = 5;
  function renderTree(
    rowsToRender: Row[],
    depth: number,
    counter: { i: number },
  ): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const row of rowsToRender) {
      counter.i += 1;
      out.push(renderRow(row, counter.i, depth));
      if (expanded.has(row.id)) {
        const kids = childrenOf(row);
        const cShown = childShown[row.id] ?? CHILD_PAGE;
        out.push(...renderTree(kids.slice(0, cShown), depth + 1, counter));
        if (kids.length > cShown) {
          out.push(
            <tr key={`submore-${row.id}`}>
              <td colSpan={displayFields.length + 2} className="p-0">
                <button
                  onClick={() =>
                    setChildShown((s) => ({ ...s, [row.id]: cShown + CHILD_PAGE }))
                  }
                  style={{ paddingLeft: (depth + 1) * 18 + 12 }}
                  className="flex items-center gap-1 py-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <ChevronDown className="size-3.5" /> Load more sub-items (
                  {kids.length - cShown} left)
                </button>
              </td>
            </tr>,
          );
        }
      }
    }
    return out;
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-3">
      <ViewQueryState
        loading={fieldsQ.isLoading || rowsQ.isLoading}
        error={fieldsQ.isError || rowsQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void rowsQ.refetch();
        }}
      />
      {/* Add field popover */}
      {adding &&
        addAnchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setAdding(false)}
            />
            <div
              className="fixed z-50 w-72 space-y-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
              style={{
                top: addAnchor.y,
                left:
                  typeof window !== "undefined"
                    ? Math.min(addAnchor.x, window.innerWidth - 300)
                    : addAnchor.x,
              }}
            >
              <p className="text-sm font-medium">New column</p>
              <input
                autoFocus
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="Column name"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <Dropdown
                value={fType}
                allowClear={false}
                options={FIELD_TYPES.map((t) => ({
                  value: t.value,
                  label: t.label,
                }))}
                onChange={(v) => v && setFType(v)}
              />
              {choiceType && (
                <input
                  value={fOptions}
                  onChange={(e) => setFOptions(e.target.value)}
                  placeholder="Options, comma-separated"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {fType === "number" && (
                <Dropdown
                  value={fFormat}
                  allowClear={false}
                  options={[
                    { value: "integer", label: "Integer" },
                    { value: "decimal", label: "Decimal" },
                    { value: "percent", label: "Percent" },
                    { value: "currency", label: "Currency" },
                  ]}
                  onChange={(v) => v && setFFormat(v)}
                />
              )}
              {fType === "number" && fFormat === "currency" && (
                <input
                  value={fCurrency}
                  onChange={(e) => setFCurrency(e.target.value)}
                  placeholder="VND"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              )}
              {fType === "relation" && (
                <>
                  <Dropdown
                    value={fTargetDb}
                    placeholder="Target database…"
                    options={(dbQ.data ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                    onChange={setFTargetDb}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fTwoWay}
                      onChange={(e) => setFTwoWay(e.target.checked)}
                      className="size-4 accent-[var(--color-primary)]"
                    />
                    Two-way (create back-link)
                  </label>
                </>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => addField.mutate()}
                  disabled={
                    !fName.trim() ||
                    addField.isPending ||
                    (fType === "relation" && !fTargetDb)
                  }
                  className="flex-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  Add column
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* Floating selection toolbar (does not push layout) */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-4 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-lg">
          <span className="font-medium">{selected.size} selected</span>
          <button
            onClick={() => duplicateRows.mutate([...selected])}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <Copy className="size-4" /> Duplicate
          </button>
          <button
            onClick={() => bulkDelete.mutate([...selected])}
            className="flex items-center gap-1 text-destructive hover:opacity-80"
          >
            <Trash2 className="size-4" /> Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            Deselect
          </button>
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none rounded-xl border bg-card [scrollbar-gutter:stable]">
        <table
          className="table-fixed select-none border-collapse text-sm"
          style={{
            width: 40 + displayFields.reduce((s, f) => s + colWidth(f), 0) + 48,
          }}
        >
          <colgroup>
            <col style={{ width: 40 }} />
            {displayFields.map((f) => (
              <col key={f.id} style={{ width: colWidth(f) }} />
            ))}
            <col style={{ width: 48 }} />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b bg-muted/40">
              <th className="bg-muted/40 px-2 py-2" style={checkboxFrozen}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set(rows.map((r) => r.id))
                        : new Set(),
                    )
                  }
                  className="size-4 accent-[var(--color-primary)]"
                />
              </th>
              {displayFields.map((f, colIdx) => (
                <th
                  key={f.id}
                  onDragOver={(e) => dragColId && e.preventDefault()}
                  onDrop={() => {
                    if (dragColId) {
                      reorderFields.mutate(
                        moveBefore(fields.map((x) => x.id), dragColId, f.id),
                      );
                      setDragColId(null);
                    }
                  }}
                  style={frozenStyle(colIdx)}
                  className="relative bg-muted/40 px-3 py-2 text-left font-medium"
                >
                  <button
                    draggable
                    onDragStart={() => setDragColId(f.id)}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu(
                        menu?.field.id === f.id
                          ? null
                          : { field: f, x: r.left, y: r.bottom + 4 },
                      );
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ field: f, x: e.clientX, y: e.clientY });
                    }}
                    title="Click to edit · drag to reorder"
                    className="flex w-full cursor-grab items-center gap-1 truncate text-left hover:text-primary active:cursor-grabbing"
                  >
                    {f.name}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {f.type}
                    </span>
                  </button>
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing({
                        fieldId: f.id,
                        startX: e.clientX,
                        startWidth: colWidth(f),
                        width: colWidth(f),
                      });
                    }}
                    title="Drag to resize"
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                  />
                </th>
              ))}
              <th className="w-12 px-2 py-2">
                <button
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setAddAnchor({ x: r.left - 240, y: r.bottom + 4 });
                    setAdding(true);
                  }}
                  title="Add column"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {treeMode && renderTree(topLevel, 0, { i: -1 })}
            {!treeMode &&
              !groups &&
              visible.map((row, idx) => renderRow(row, idx))}
            {!treeMode &&
              groups &&
              groupFieldId &&
              (() => {
                let i = -1;
                return groups.map((g) => {
                  const isCollapsed = collapsed.has(g.key);
                  return (
                    <Fragment key={g.key}>
                      <tr className="border-y bg-muted/40">
                        <td colSpan={displayFields.length + 2} className="p-0">
                          <button
                            onClick={() =>
                              setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(g.key)) next.delete(g.key);
                                else next.add(g.key);
                                return next;
                              })
                            }
                            className="sticky left-0 flex items-center gap-2 px-3 py-2 text-sm font-semibold"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="size-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="size-4 text-muted-foreground" />
                            )}
                            <ValueChip field={byId[groupFieldId]} value={g.value} />
                            <span className="text-xs font-normal text-muted-foreground">
                              {g.rows.length}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        g.rows.map((row) => {
                          i += 1;
                          return renderRow(row, i);
                        })}
                    </Fragment>
                  );
                });
              })()}
          </tbody>
        </table>

        {fields.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No columns yet. Click <Plus className="inline size-4" /> to add one.
          </div>
        )}
      </div>

      {/* Action bar — pinned below the table (always visible). */}
      <div className="flex shrink-0 items-center gap-2">
        {rowsQ.hasNextPage && (
          <button
            type="button"
            onClick={() => rowsQ.fetchNextPage()}
            disabled={rowsQ.isFetchingNextPage}
            className="flex items-center gap-1 rounded-md border px-3 py-1 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <ChevronDown
              className={`size-4 ${rowsQ.isFetchingNextPage ? "animate-bounce" : ""}`}
            />
            {rowsQ.isFetchingNextPage
              ? "Loading…"
              : `Load more (${Math.max(totalRows - rowItems.length, 0)} left)`}
          </button>
        )}
        <button
          onClick={() => addRow.mutate()}
          disabled={fields.length === 0 || addRow.isPending}
          title="Create a new row (N)"
          className="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-4" /> New <kbd className="text-[10px] opacity-60">N</kbd>
        </button>
        <BulkAddRows
          disabled={fields.length === 0 || bulkAdd.isPending}
          onAdd={(n) => bulkAdd.mutate(n)}
        />
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Showing {rowItems.length} of {totalRows} records
          </span>
        </div>
      </div>

      {/* Calculate summary — below the action bar; bold results for calc'd columns. */}
      {calcFields.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          {calcFields.map((f) => (
            <span key={f.id} className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{f.name}</span>
              <span className="font-bold">{computeCalc(f, visible, calc[f.id])}</span>
            </span>
          ))}
        </div>
      )}

      {menu && (
        <ColumnMenu
          field={menu.field}
          databaseId={databaseId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onInsert={(side) => insertField(side, menu.field.id)}
          frozen={fields.findIndex((f) => f.id === menu.field.id) <= frozenUpTo}
          onFreezeToggle={() => {
            const i = fields.findIndex((f) => f.id === menu.field.id);
            setFrozenUpTo(i <= frozenUpTo ? i - 1 : i);
          }}
          sorts={sorts}
          setSorts={setSorts}
          groupFieldId={groupFieldId}
          setGroupFieldId={setGroupFieldId}
          filterRoot={filterRoot}
          setFilterRoot={setFilterRoot}
          calcValue={calc[menu.field.id] ?? ""}
          setCalc={(v) => setCalc((c) => ({ ...c, [menu.field.id]: v }))}
          calcOptions={calcOptions(menu.field.type)}
        />
      )}

    </div>
  );
}
