"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { CellEditor } from "@/components/table/cell-editor";
import { ColumnMenu } from "@/components/table/column-menu";
import { Dropdown } from "@/components/ui/dropdown";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];
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
  { value: "select", label: "Select", choices: true },
  { value: "multi_select", label: "Multi-select", choices: true },
  { value: "status", label: "Status", choices: true },
  { value: "priority", label: "Priority", choices: true },
  { value: "rating", label: "Rating (1-5)", choices: false },
];

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


export function TableView({ databaseId }: { databaseId: string }) {
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

  const dbQ = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const dbName = dbQ.data?.find((d) => d.id === databaseId)?.name ?? "Database";

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const rowsQ = useQuery<Row[]>({
    queryKey: ["rows", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fields", databaseId] });
    qc.invalidateQueries({ queryKey: ["rows", databaseId] });
  };

  const addField = useMutation({
    mutationFn: () =>
      apiFetch<Field>(`/databases/${databaseId}/fields`, {
        method: "POST",
        body: JSON.stringify({
          name: fName.trim(),
          type: fType,
          options: buildOptions(fType, fOptions, fFormat, fCurrency),
        }),
      }),
    onSuccess: () => {
      setAdding(false);
      setFName("");
      setFType("text");
      setFOptions("");
      setFFormat("integer");
      setFCurrency("VND");
      invalidate();
    },
  });

  const addRow = useMutation({
    mutationFn: () =>
      apiFetch<Row>(`/databases/${databaseId}/rows`, {
        method: "POST",
        body: JSON.stringify({ data: {} }),
      }),
    onSuccess: invalidate,
  });

  const deleteRow = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/rows/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const updateCell = useMutation({
    mutationFn: ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) =>
      apiFetch<Row>(`/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows", databaseId] }),
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
      const byId = new Map((rowsQ.data ?? []).map((r) => [r.id, r.data]));
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

  function handleRowClick(idx: number, id: string, shift: boolean) {
    const rs = rowsQ.data ?? [];
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
      const rs = rowsQ.data ?? [];
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
  }, [anchor, cursor, rowsQ.data]);

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

  function moveBefore(ids: string[], fromId: string, toId: string): string[] {
    if (fromId === toId) return ids;
    const arr = ids.filter((i) => i !== fromId);
    const to = arr.indexOf(toId);
    arr.splice(to < 0 ? arr.length : to, 0, fromId);
    return arr;
  }

  const fields = fieldsQ.data ?? [];
  const rows = rowsQ.data ?? [];
  const choiceType = ["select", "multi_select"].includes(fType);

  // --- Excel-style cell range selection ---
  const [range, setRange] = useState<{
    r1: number;
    c1: number;
    r2: number;
    c2: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

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
      if (e.key === "Escape") {
        setRange(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C") && range) {
        const tag = document.activeElement?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        const rs = rowsQ.data ?? [];
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
  }, [range, rowsQ.data, fieldsQ.data]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/databases"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Databases
        </Link>
        <h1 className="text-2xl font-bold">{dbName}</h1>
      </div>

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
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => addField.mutate()}
                  disabled={!fName.trim() || addField.isPending}
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
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table
          className="table-fixed border-collapse text-sm"
          style={{
            width: 40 + fields.reduce((s, f) => s + colWidth(f), 0) + 48,
          }}
        >
          <colgroup>
            <col style={{ width: 40 }} />
            {fields.map((f) => (
              <col key={f.id} style={{ width: colWidth(f) }} />
            ))}
            <col style={{ width: 48 }} />
          </colgroup>
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-2 py-2">
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
              {fields.map((f) => (
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
                  className="relative px-3 py-2 text-left font-medium"
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
            {rows.map((row, idx) => (
              <tr
                key={row.id}
                onDragOver={(e) => dragRowId && e.preventDefault()}
                onDrop={() => {
                  if (dragRowId) {
                    reorderRows.mutate(
                      moveBefore(rows.map((r) => r.id), dragRowId, row.id),
                    );
                    setDragRowId(null);
                  }
                }}
                className={`group border-b last:border-0 ${
                  selected.has(row.id) ? "bg-accent/30" : ""
                }`}
              >
                <td className="whitespace-nowrap px-2 text-center">
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
                {fields.map((f, colIdx) => (
                  <td
                    key={f.id}
                    onMouseDown={() => {
                      setRange({ r1: idx, c1: colIdx, r2: idx, c2: colIdx });
                      setDragging(true);
                    }}
                    onMouseEnter={() => {
                      if (dragging)
                        setRange((r) =>
                          r ? { ...r, r2: idx, c2: colIdx } : r,
                        );
                    }}
                    className={`overflow-hidden border-r px-1 align-middle ${
                      inRange(idx, colIdx) ? "bg-primary/10" : ""
                    }`}
                  >
                    {f.type === "unique_id" ? (
                      <span className="px-2 text-sm text-muted-foreground">
                        {((f.options as { prefix?: string })?.prefix ?? "") +
                          row.seq}
                      </span>
                    ) : (
                      <CellEditor
                        field={f}
                        value={
                          (row.data as Record<string, unknown>)[f.id] ?? null
                        }
                        onCommit={(v) =>
                          updateCell.mutate({
                            rowId: row.id,
                            data: { [f.id]: v },
                          })
                        }
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 text-center">
                  <button
                    onClick={() => deleteRow.mutate(row.id)}
                    title="Delete row"
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {fields.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No columns yet. Click <Plus className="inline size-4" /> to add one.
          </div>
        )}
      </div>

      <button
        onClick={() => addRow.mutate()}
        disabled={fields.length === 0 || addRow.isPending}
        className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        <Plus className="size-4" />
        New row
      </button>

      {menu && (
        <ColumnMenu
          field={menu.field}
          databaseId={databaseId}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
