"use client";

import { Fragment, useState } from "react";
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

/** Notion-style List: compact rows, editable title + inline property chips. */
export function ListView({
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
    onSuccess: invalidate,
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
  const idField = fields.find((f) => f.type === "unique_id");
  // Inline properties: visible non-title fields (skip unique_id), up to 4.
  const propFields = fields
    .filter(
      (f) => !hidden.has(f.id) && f.id !== titleField?.id && f.type !== "unique_id",
    )
    .slice(0, 4);

  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupRows(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");

  const shown = limit * (pages + 1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const propCell = (f: Field, row: Row) => {
    const v = (row.data as Record<string, unknown>)[f.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    if (CHIP_TYPES.has(f.type))
      return <ValueChip key={f.id} field={f} value={Array.isArray(v) ? v[0] : v} />;
    return (
      <span
        key={f.id}
        className="flex min-w-0 max-w-56 items-center gap-1 truncate text-xs"
        title={`${f.name}: ${displayText(f, v)}`}
      >
        <span className="shrink-0 text-muted-foreground">{f.name}</span>
        <span className="truncate font-medium">{displayText(f, v)}</span>
      </span>
    );
  };

  const renderRow = (row: Row) => (
    <div
      key={row.id}
      data-row-id={row.id}
      className="group flex min-h-11 items-center gap-3 border-b px-3 py-2 transition-colors hover:bg-muted/40"
    >
      {idField && (
        <span className="w-12 shrink-0 text-xs text-muted-foreground">
          {((idField.options as { prefix?: string })?.prefix ?? "") + row.seq}
        </span>
      )}
      <div className="min-w-0 flex-1 text-sm font-medium">
        {titleField ? (
          <CellEditor
            field={titleField}
            value={(row.data as Record<string, unknown>)[titleField.id] ?? null}
            onCommit={(v) =>
              updateCell.mutate({ rowId: row.id, data: { [titleField.id]: v } })
            }
          />
        ) : (
          <span>#{row.seq}</span>
        )}
      </div>
      <div className="hidden min-w-0 shrink items-center justify-end gap-3 md:flex">
        {propFields.map((f) => propCell(f, row))}
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
        {fields.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No columns yet.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No rows match this view.
          </div>
        ) : groups ? (
          groups.map((g) => {
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
                  className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-semibold"
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
                {open && g.rows.map(renderRow)}
              </Fragment>
            );
          })
        ) : (
          visible.slice(0, shown).map(renderRow)
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
          className="flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-4" /> New
        </button>
      </div>
    </div>
  );
}
