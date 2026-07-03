"use client";

import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import type { SharedViewProps } from "@/components/table/view-shell";
import {
  applyFilterTree,
  applySorts,
  displayText,
  groupRows,
  type FilterGroup,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];

const CHIP_TYPES = new Set([
  "select",
  "status",
  "priority",
  "country",
  "checkbox",
  "multi_select",
]);

/** Notion-style Gallery: a responsive grid of cards (editable title + props). */
export function GalleryView({
  databaseId,
  filterRoot,
  sorts,
  groupFieldId,
  hideEmpty,
  hidden,
  limit,
  filterToMatches,
  matchedIds,
}: { databaseId: string } & SharedViewProps) {
  const qc = useQueryClient();
  const [pages, setPages] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const rowsQ = useQuery<Row[]>({
    queryKey: ["rows", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["rows", databaseId] });
  const updateCell = useMutation({
    mutationFn: ({ rowId, data }: { rowId: string; data: Record<string, unknown> }) =>
      apiFetch<Row>(`/rows/${rowId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: (created) => {
      setEditingRowId(created.id);
      setPages(Math.floor((rowsQ.data?.length ?? 0) / limit));
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
    mutationFn: (id: string) => apiFetch<void>(`/rows/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
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

  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let visible = applySorts(
    applyFilterTree(rowsQ.data ?? [], byId, filterRoot as FilterGroup),
    byId,
    sorts,
  );
  if (filterToMatches && matchedIds)
    visible = visible.filter((r) => matchedIds.has(r.id));

  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  // Card properties: visible non-title fields (skip unique_id), up to 5.
  const propFields = fields
    .filter(
      (f) => !hidden.has(f.id) && f.id !== titleField?.id && f.type !== "unique_id",
    )
    .slice(0, 5);

  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupRows(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");

  const shown = limit * (pages + 1);

  const propValue = (f: Field, row: Row) => {
    const v = (row.data as Record<string, unknown>)[f.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    return (
      <div key={f.id} className="flex items-center gap-1.5 text-xs">
        <span className="shrink-0 text-muted-foreground">{f.name}</span>
        {CHIP_TYPES.has(f.type) ? (
          <ValueChip field={f} value={Array.isArray(v) ? v[0] : v} />
        ) : (
          <span className="truncate font-medium">{displayText(f, v)}</span>
        )}
      </div>
    );
  };

  const card = (row: Row) => (
    <div
      key={row.id}
      data-row-id={row.id}
      className="group flex min-h-32 flex-col gap-3 rounded-xl border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-semibold">
          {titleField ? (
            <CellEditor
              key={editingRowId === row.id ? "edit" : "view"}
              field={titleField}
              value={(row.data as Record<string, unknown>)[titleField.id] ?? null}
              onCommit={(v) =>
                updateCell.mutate({ rowId: row.id, data: { [titleField.id]: v } })
              }
              autoEdit={editingRowId === row.id}
              onFinish={() => setEditingRowId(null)}
            />
          ) : (
            <span>#{row.seq}</span>
          )}
        </div>
        <button
          onClick={() => deleteRow.mutate(row.id)}
          title="Delete"
          aria-label="Delete row"
          className="shrink-0 rounded p-1 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
        </button>
      </div>
      <div className="space-y-1">{propFields.map((f) => propValue(f, row))}</div>
    </div>
  );

  const grid = (rs: Row[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
      {rs.map(card)}
    </div>
  );

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
      <div className="min-h-0 flex-1 overflow-auto">
        {fields.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No columns yet.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No rows match this view.
          </div>
        ) : groups ? (
          <div className="space-y-4">
            {groups.map((g) => {
              const open = !collapsed.has(g.key);
              return (
                <Fragment key={g.key}>
                  <button
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    {open ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                    <ValueChip field={byId[groupFieldId!]} value={g.value} />
                    <span className="text-xs font-normal text-muted-foreground">
                      {g.rows.length}
                    </span>
                  </button>
                  {open && grid(g.rows)}
                </Fragment>
              );
            })}
          </div>
        ) : (
          grid(visible.slice(0, shown))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {!groups && shown < visible.length && (
          <button
            onClick={() => setPages((p) => p + 1)}
            className="flex items-center gap-1 rounded-md border px-3 py-1 text-sm font-medium text-primary hover:bg-primary/10"
          >
            <ChevronDown className="size-4" /> Load more ({visible.length - shown} left)
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
      </div>
    </div>
  );
}
