"use client";

import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FaIcon, Plus, Trash2 } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import { EntityNameDialog } from "@/components/table/entity-name-dialog";
import type { SharedViewProps } from "@/components/table/view-shell";
import {
  applyFilterTree,
  applySorts,
  displayText,
  groupEntities,
  type FilterGroup,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";
import { formatEntityId } from "@/lib/entity-id";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];

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
  dataSourceId,
  filterToMatches,
  matchedIds,
  openEntity,
}: { databaseId: string } & SharedViewProps) {
  const qc = useQueryClient();
  const [pages, setPages] = useState(0);
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);

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
  const invalidate = () => qc.invalidateQueries({ queryKey: ["entities", databaseId] });
  const updateCell = useMutation({
    mutationFn: ({ entityId, data }: { entityId: string; data: Record<string, unknown> }) =>
      apiFetch<Entity>(`/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: (created) => {
      setEditingEntityId(created.id);
      setPages(Math.floor((entitiesQ.data?.length ?? 0) / limit));
      invalidate();
    },
  });
  const addEntity = useMutation({
    mutationFn: (name: string) =>
      apiFetch<Entity>(`/databases/${databaseId}/entities`, {
        method: "POST",
        body: JSON.stringify({ name, data: {} }),
      }),
    onSuccess: () => {
      setNewEntityOpen(false);
      invalidate();
    },
  });
  const deleteEntity = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/entities/${id}`, { method: "DELETE" }),
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
      setNewEntityOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let visible = applySorts(
    applyFilterTree(entitiesQ.data ?? [], byId, filterRoot as FilterGroup),
    byId,
    sorts,
  );
  if (filterToMatches && matchedIds)
    visible = visible.filter((r) => matchedIds.has(r.id));

  const titleField = fields.find((f) => ["text", "long_text"].includes(f.type));
  const idField = fields.find((f) => f.type === "unique_id");
  // Card properties: visible non-title fields (skip unique_id), up to 5.
  const propFields = fields
    .filter(
      (f) => !hidden.has(f.id) && f.id !== titleField?.id && f.type !== "unique_id",
    )
    .slice(0, 5);

  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupEntities(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");

  const shown = limit * (pages + 1);

  const propValue = (f: Field, entity: Entity) => {
    const v = (entity.data as Record<string, unknown>)[f.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    return (
      <div key={f.id} className="flex items-center gap-1.5 text-[11px] leading-4">
        <span className="shrink-0 text-muted-foreground">{f.name}</span>
        {CHIP_TYPES.has(f.type) ? (
          <ValueChip field={f} value={Array.isArray(v) ? v[0] : v} />
        ) : (
          <span className="truncate font-medium">{displayText(f, v)}</span>
        )}
      </div>
    );
  };

  const card = (entity: Entity) => (
    <div
      key={entity.id}
      data-entity-id={entity.id}
      className="group flex min-h-28 flex-col gap-2 rounded-lg border bg-card p-3 text-[11px] leading-4 transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-primary/30 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-[11px] font-semibold leading-4">
          {titleField ? (
            <CellEditor
              key={editingEntityId === entity.id ? "edit" : "view"}
              field={titleField}
              value={(entity.data as Record<string, unknown>)[titleField.id] ?? null}
              onCommit={(v) =>
                updateCell.mutate({ entityId: entity.id, data: { [titleField.id]: v } })
              }
              autoEdit={editingEntityId === entity.id}
              onFinish={() => setEditingEntityId(null)}
            />
          ) : (
            <span>{formatEntityId(entity, idField)}</span>
          )}
        </div>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => openEntity(entity)}
            title="Open entity"
            aria-label={`Open ${entity.name}`}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <FaIcon name="window-maximize.1" className="size-3.5" />
          </button>
          <button
            onClick={() => deleteEntity.mutate(entity.id)}
            title="Delete"
            aria-label="Delete entity"
            className="shrink-0 rounded p-1 text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </span>
      </div>
      <div className="space-y-0.5">{propFields.map((f) => propValue(f, entity))}</div>
    </div>
  );

  const grid = (rs: Entity[]) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2">
      {rs.map(card)}
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-2">
      <ViewQueryState
        loading={fieldsQ.isLoading || entitiesQ.isLoading}
        error={fieldsQ.isError || entitiesQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void entitiesQ.refetch();
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        {fields.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No columns yet.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
            No entities match this layout.
          </div>
        ) : groups ? (
          <div className="space-y-3">
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
                    className="flex h-7 items-center gap-1.5 text-[11px] font-semibold"
                  >
                    {open ? (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    )}
                    <ValueChip field={byId[groupFieldId!]} value={g.value} />
                    <span className="text-xs font-normal text-muted-foreground">
                      {g.entities.length}
                    </span>
                  </button>
                  {open && grid(g.entities)}
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
            className="flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-primary hover:bg-primary/10"
          >
            <ChevronDown className="size-4" /> Load more ({visible.length - shown} left)
          </button>
        )}
        <button
          onClick={() => setNewEntityOpen(true)}
          disabled={fields.length === 0 || addEntity.isPending}
          title="Create a new entity (N)"
          className="flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-4" /> New <kbd className="text-[10px] opacity-60">N</kbd>
        </button>
      </div>
      <EntityNameDialog
        open={newEntityOpen}
        pending={addEntity.isPending}
        onClose={() => setNewEntityOpen(false)}
        onCreate={(name) => addEntity.mutate(name)}
      />
    </div>
  );
}
