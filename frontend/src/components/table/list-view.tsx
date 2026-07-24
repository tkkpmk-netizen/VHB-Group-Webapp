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

/** Notion-style List: compact entities, editable title + inline property chips. */
export function ListView({
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
  // Inline properties: visible non-title fields (skip unique_id), up to 4.
  const propFields = fields
    .filter(
      (f) => !hidden.has(f.id) && f.id !== titleField?.id && f.type !== "unique_id",
    )
    .slice(0, 4);

  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupEntities(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");

  const shown = limit * (pages + 1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const propCell = (f: Field, entity: Entity) => {
    const v = (entity.data as Record<string, unknown>)[f.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
    if (CHIP_TYPES.has(f.type))
      return <ValueChip key={f.id} field={f} value={Array.isArray(v) ? v[0] : v} />;
    return (
      <span
        key={f.id}
        className="flex min-w-0 max-w-40 items-center gap-1 truncate text-[11px] leading-4"
        title={`${f.name}: ${displayText(f, v)}`}
      >
        <span className="shrink-0 text-muted-foreground">{f.name}</span>
        <span className="truncate font-medium">{displayText(f, v)}</span>
      </span>
    );
  };

  const renderEntity = (entity: Entity) => (
    <div
      key={entity.id}
      data-entity-id={entity.id}
      className="group flex h-[30px] items-center gap-2 border-b px-2 text-[11px] leading-4 transition-colors hover:bg-muted/40"
    >
      {idField && (
        <span className="w-10 shrink-0 text-[10px] text-muted-foreground">
          {formatEntityId(entity, idField)}
        </span>
      )}
      <div className="min-w-0 flex-1 text-[11px] font-medium">
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
      <div className="hidden min-w-0 shrink items-center justify-end gap-2 md:flex">
        {propFields.map((f) => propCell(f, entity))}
      </div>
      <button
        type="button"
        onClick={() => openEntity(entity)}
        title="Open entity"
        aria-label={`Open ${entity.name}`}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <FaIcon name="window-maximize.1" className="size-3.5" />
      </button>
      <button
        onClick={() => deleteEntity.mutate(entity.id)}
        title="Delete"
        aria-label="Delete entity"
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col gap-1.5">
      <ViewQueryState
        loading={fieldsQ.isLoading || entitiesQ.isLoading}
        error={fieldsQ.isError || entitiesQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void entitiesQ.refetch();
        }}
      />
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
        {fields.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No columns yet.
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            No entities match this layout.
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
                  className="sticky top-0 z-10 flex h-7 w-full items-center gap-1.5 border-b bg-muted/40 px-2 text-[11px] font-semibold"
                >
                  {open ? (
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  )}
                  <ValueChip field={byId[groupFieldId!]} value={g.value} />
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {g.entities.length}
                  </span>
                </button>
                {open && g.entities.map(renderEntity)}
              </Fragment>
            );
          })
        ) : (
          visible.slice(0, shown).map(renderEntity)
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
          className="flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
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
