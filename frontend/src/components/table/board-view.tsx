"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import {
  applyFilterTree,
  applySorts,
  displayText,
  toText,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];
type Choice = { id: string; label: string };
type Col = { key: string; label: string; value: unknown; chip: boolean };

const CHIP_TYPES = new Set(["select", "status", "priority", "country", "checkbox"]);
const SKIP_ON_CARD = new Set(["unique_id", "long_text"]);
// Types we can't set by dragging a card (computed / multi-value / auto).
const NON_SETTABLE = new Set([
  "rollup",
  "formula",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "multi_select",
  "relation",
  "people",
  "unique_id",
]);
const isEmpty = (v: unknown) =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

function columnsFor(f: Field, rows: Row[]): Col[] {
  const none: Col = { key: "__none__", label: `No ${f.name}`, value: null, chip: false };
  if (["select", "status", "priority"].includes(f.type)) {
    const choices = (f.options as { choices?: Choice[] })?.choices ?? [];
    return [none, ...choices.map((c) => ({ key: c.id, label: c.label, value: c.id, chip: true }))];
  }
  if (f.type === "checkbox")
    return [
      { key: "true", label: "Checked", value: true, chip: false },
      { key: "false", label: "Unchecked", value: false, chip: false },
    ];
  // Generic: one column per distinct displayed value present in the data.
  const seen = new Map<string, Col>();
  for (const r of rows) {
    const v = (r.data as Record<string, unknown>)[f.id];
    if (isEmpty(v)) continue;
    const label = toText(f, v);
    if (!seen.has(label)) seen.set(label, { key: label, label, value: v, chip: false });
  }
  return [none, ...seen.values()];
}

function matches(f: Field, row: Row, col: Col): boolean {
  const v = (row.data as Record<string, unknown>)[f.id];
  if (f.type === "checkbox") return (v === true) === (col.value === true);
  if (col.value === null) return isEmpty(v);
  return v === col.value || toText(f, v) === toText(f, col.value);
}

export function BoardView({
  databaseId,
  boardField,
  boardSubgroup,
  filterRoot,
  sorts,
  limit,
  hidden,
  filterToMatches,
  matchedIds,
}: {
  databaseId: string;
  boardField: string | null;
  boardSubgroup: string | null;
  filterRoot: FilterGroup;
  sorts: SortRule[];
  limit: number;
  hidden: Set<string>;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
}) {
  const qc = useQueryClient();
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  // Per-column "load more" clicks, keyed by swimlane:column.
  const [colPages, setColPages] = useState<Record<string, number>>({});

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
  rows = applySorts(rows, byId, sorts);

  const groupable = fields.filter((f) =>
    ["select", "status", "priority"].includes(f.type),
  );
  const field = boardField ? byId[boardField] : groupable[0];
  const subField = boardSubgroup ? byId[boardSubgroup] : undefined;
  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  const cardFields = fields
    .filter(
      (f) =>
        !hidden.has(f.id) &&
        f.id !== field?.id &&
        f.id !== subField?.id &&
        f.id !== titleField?.id &&
        !SKIP_ON_CARD.has(f.type),
    )
    .slice(0, 3);

  const save = useMutation({
    mutationFn: ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) =>
      apiFetch<Row>(`/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows", databaseId] }),
  });
  const addCard = useMutation({
    mutationFn: ({
      data,
    }: {
      data: Record<string, unknown>;
      pageKey: string;
    }) =>
      apiFetch<Row>(`/databases/${databaseId}/rows`, {
        method: "POST",
        body: JSON.stringify({ data }),
      }),
    onSuccess: (created, variables) => {
      setEditingRowId(created.id);
      setColPages((pages) => ({
        ...pages,
        [variables.pageKey]: Math.ceil(((rowsQ.data?.length ?? 0) + 1) / limit),
      }));
      qc.invalidateQueries({ queryKey: ["rows", databaseId] });
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
        target?.isContentEditable ||
        !field
      )
        return;
      e.preventDefault();
      const col = columnsFor(field, rows)[0];
      const data: Record<string, unknown> = {};
      if (!NON_SETTABLE.has(field.type)) data[field.id] = col.value;
      addCard.mutate({ data, pageKey: `:${col.key}` });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!field)
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Mở <b>Settings → Board → Group by</b> để chọn field chia cột.
      </div>
    );

  // The cell map for a card placed in (column, swimlane).
  function placement(col: Col, sub?: Col): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (!NON_SETTABLE.has(field!.type)) data[field!.id] = col.value;
    if (subField && sub && !NON_SETTABLE.has(subField.type))
      data[subField.id] = sub.value;
    return data;
  }
  function dropOn(col: Col, sub?: Col) {
    if (!dragRow) return;
    const data = placement(col, sub);
    if (Object.keys(data).length) save.mutate({ rowId: dragRow, data });
    setDragRow(null);
  }

  const columns = columnsFor(field, rows);
  const swimlanes: (Col | null)[] = subField ? columnsFor(subField, rows) : [null];

  const cardTitle = (r: Row) => {
    const v = titleField ? (r.data as Record<string, unknown>)[titleField.id] : null;
    return typeof v === "string" && v ? v : `#${r.seq}`;
  };

  // Plain render fns (NOT components) so columns don't remount on every parent
  // re-render — which would reset each column's scroll to the top.
  const renderCard = (r: Row) => (
      <div
        key={r.id}
        draggable={editingRowId !== r.id}
        onDragStart={() => setDragRow(r.id)}
        className="cursor-grab space-y-2 rounded-lg border bg-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:cursor-grabbing"
      >
        <div className="text-sm font-medium">
          {titleField ? (
            <CellEditor
              key={editingRowId === r.id ? "edit" : "view"}
              field={titleField}
              value={(r.data as Record<string, unknown>)[titleField.id] ?? null}
              onCommit={(value) =>
                save.mutate({ rowId: r.id, data: { [titleField.id]: value } })
              }
              autoEdit={editingRowId === r.id}
              onFinish={() => setEditingRowId(null)}
            />
          ) : (
            cardTitle(r)
          )}
        </div>
        {cardFields.map((f) => {
          const v = (r.data as Record<string, unknown>)[f.id];
          if (isEmpty(v)) return null;
          return (
            <div key={f.id} className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">{f.name}:</span>
              {CHIP_TYPES.has(f.type) ? (
                <ValueChip field={f} value={Array.isArray(v) ? v[0] : v} />
              ) : (
                <span className="truncate">{displayText(f, v)}</span>
              )}
            </div>
          );
        })}
      </div>
    );

  const renderColumn = (col: Col, sub?: Col) => {
    const cards = rows.filter(
      (r) => matches(field!, r, col) && (!sub || matches(subField!, r, sub)),
    );
    const pgKey = `${sub?.key ?? ""}:${col.key}`;
    const shown = limit * ((colPages[pgKey] ?? 0) + 1);
    const visible = cards.slice(0, shown);
    const moreCount = cards.length - visible.length;
    return (
      <div
        key={`${sub?.key ?? ""}:${col.key}`}
        onDragOver={(e) => dragRow && e.preventDefault()}
        onDrop={() => dropOn(col, sub)}
        className="flex max-h-[calc(100vh-17rem)] min-h-56 w-72 shrink-0 flex-col rounded-xl border bg-muted/30"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          {col.chip ? (
            <ValueChip field={field!} value={col.value} />
          ) : (
            <span className="text-sm text-muted-foreground">{col.label}</span>
          )}
          <span className="text-xs text-muted-foreground">{cards.length}</span>
          <button
            onClick={() =>
              addCard.mutate({ data: placement(col, sub), pageKey: pgKey })
            }
            title={`Create in ${col.label}`}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
          {visible.length === 0 && (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
              Drop a card here or create a new one.
            </div>
          )}
          {visible.map((r) => renderCard(r))}
          {moreCount > 0 && (
            <button
              onClick={() =>
                setColPages((p) => ({ ...p, [pgKey]: (p[pgKey] ?? 0) + 1 }))
              }
              className="flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
            >
              <ChevronDown className="size-3.5" /> Load more ({moreCount})
            </button>
          )}
          <button
            onClick={() =>
              addCard.mutate({ data: placement(col, sub), pageKey: pgKey })
            }
            className="flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-3.5" /> New
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative min-h-40 space-y-4">
      <ViewQueryState
        loading={fieldsQ.isLoading || rowsQ.isLoading}
        error={fieldsQ.isError || rowsQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void rowsQ.refetch();
        }}
      />
      {swimlanes.map((sub) => (
        <div key={sub?.key ?? "all"} className="space-y-2">
          {sub && (
            <div className="flex items-center gap-2 border-b pb-1 text-sm font-medium">
              {sub.chip ? (
                <ValueChip field={subField!} value={sub.value} />
              ) : (
                <span>{sub.label}</span>
              )}
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((col) => renderColumn(col, sub ?? undefined))}
          </div>
        </div>
      ))}
    </div>
  );
}
