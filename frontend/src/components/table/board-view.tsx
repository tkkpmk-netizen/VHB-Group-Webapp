"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { ValueChip } from "@/components/table/cell-editor";
import { applyFilterTree, toText, type FilterGroup } from "@/lib/view";
import type { components } from "@/lib/api/schema";

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

/** Human-readable value for a card field (dates as short locale dates, the
 *  rest via toText so objects never render as "[object Object]"). */
function cardValue(f: Field, v: unknown): string {
  if (f.type === "date") {
    const s =
      typeof v === "object" && v
        ? ((v as { start?: string }).start ?? "")
        : String(v);
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : s;
  }
  return toText(f, v);
}

export function BoardView({
  databaseId,
  boardField,
  boardSubgroup,
  filterRoot,
  hidden,
  filterToMatches,
  matchedIds,
}: {
  databaseId: string;
  boardField: string | null;
  boardSubgroup: string | null;
  filterRoot: FilterGroup;
  hidden: Set<string>;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
}) {
  const qc = useQueryClient();
  const [dragRow, setDragRow] = useState<string | null>(null);

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
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<Row>(`/databases/${databaseId}/rows`, {
        method: "POST",
        body: JSON.stringify({ data }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rows", databaseId] }),
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

  function Card({ r }: { r: Row }) {
    const shown = cardFields
      .map((f) => ({ f, v: (r.data as Record<string, unknown>)[f.id] }))
      .filter(({ v }) => !isEmpty(v));
    return (
      <div
        draggable
        onDragStart={() => setDragRow(r.id)}
        className="group cursor-grab rounded-lg border border-border/70 bg-card p-3 shadow-sm transition-shadow hover:border-border hover:shadow-md active:cursor-grabbing"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold leading-snug">
            {cardTitle(r)}
          </span>
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground/70">
            #{r.seq}
          </span>
        </div>
        {shown.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {shown.map(({ f, v }) => (
              <div key={f.id} className="flex items-center gap-1.5 text-xs">
                <span className="shrink-0 text-muted-foreground">{f.name}</span>
                {CHIP_TYPES.has(f.type) ? (
                  <ValueChip field={f} value={Array.isArray(v) ? v[0] : v} />
                ) : (
                  <span className="truncate font-medium">{cardValue(f, v)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function Column({ col, sub }: { col: Col; sub?: Col }) {
    const cards = rows.filter(
      (r) => matches(field!, r, col) && (!sub || matches(subField!, r, sub)),
    );
    return (
      <div
        onDragOver={(e) => dragRow && e.preventDefault()}
        onDrop={() => dropOn(col, sub)}
        className="flex max-h-[72vh] w-72 shrink-0 flex-col rounded-xl bg-muted/40"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {col.chip ? (
              <ValueChip field={field!} value={col.value} />
            ) : (
              <span className="truncate text-sm font-semibold">{col.label}</span>
            )}
            <span className="rounded-full bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {cards.length}
            </span>
          </div>
          <button
            onClick={() => addCard.mutate(placement(col, sub))}
            title="Add card"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          {cards.map((r) => (
            <Card key={r.id} r={r} />
          ))}
          <button
            onClick={() => addCard.mutate(placement(col, sub))}
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-transparent px-2 py-2 text-xs font-medium text-muted-foreground hover:border-border hover:bg-background"
          >
            <Plus className="size-3.5" /> New
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
            {columns.map((col) => (
              <Column key={col.key} col={col} sub={sub ?? undefined} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
