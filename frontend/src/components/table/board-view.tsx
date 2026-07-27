"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronDown, FaIcon, Plus } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import { EntityNameDialog } from "@/components/table/entity-name-dialog";
import {
  displayText,
  serverFilterTreeFor,
  toText,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import {
  choiceColor,
  colorSurface,
  conditionalColorForEntity,
  conditionalColorForGroup,
  type ConditionalColorConfig,
} from "@/lib/conditional-colors";
import { mergeUniqueById } from "@/lib/entity-tree";
import type { components } from "@/lib/api/schema";
import { ViewQueryState } from "@/components/table/view-query-state";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];
type EntityPage = components["schemas"]["EntityPage"];
type EntityGroup = components["schemas"]["EntityGroup"];
type Choice = { id: string; label: string; color?: string };
type Col = {
  key: string;
  label: string;
  value: unknown;
  chip: boolean;
  total: number;
  color?: string;
};

const CHIP_TYPES = new Set(["select", "status", "priority", "country", "checkbox"]);
const SKIP_ON_CARD = new Set(["unique_id", "long_text"]);
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
const GROUP_PAGE_SIZE = 10;
const isEmpty = (value: unknown) =>
  value == null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);
const identity = (value: unknown) => JSON.stringify(value) ?? "__undefined__";

function columnsForGroups(field: Field, groups: EntityGroup[]): Col[] {
  const totals = new Map(
    groups.map((group) => [identity(group.key), group.total]),
  );
  const none: Col = {
    key: "__none__",
    label: `No ${field.name}`,
    value: null,
    chip: false,
    total: totals.get(identity(null)) ?? totals.get(identity("")) ?? 0,
  };
  if (["select", "status", "priority"].includes(field.type)) {
    const choices =
      (field.options as { choices?: Choice[] })?.choices ?? [];
    const configured = choices.map((choice) => ({
      key: choice.id,
      label: choice.label,
      value: choice.id,
      chip: true,
      total: totals.get(identity(choice.id)) ?? 0,
      color: choice.color,
    }));
    const known = new Set(choices.map((choice) => identity(choice.id)));
    const extras = groups
      .filter(
        (group) =>
          !isEmpty(group.key) && !known.has(identity(group.key)),
      )
      .map((group) => ({
        key: identity(group.key),
        label: toText(field, group.key),
        value: group.key,
        chip: false,
        total: group.total,
      }));
    return [none, ...configured, ...extras];
  }
  if (field.type === "checkbox") {
    return [
      {
        key: "true",
        label: "Checked",
        value: true,
        chip: false,
        total: totals.get(identity(true)) ?? 0,
      },
      {
        key: "false",
        label: "Unchecked",
        value: false,
        chip: false,
        total: totals.get(identity(false)) ?? 0,
      },
    ];
  }
  return [
    none,
    ...groups
      .filter((group) => !isEmpty(group.key))
      .map((group) => ({
        key: identity(group.key),
        label: toText(field, group.key),
        value: group.key,
        chip: false,
        total: group.total,
      })),
  ];
}

export function BoardView({
  databaseId,
  boardField,
  boardSubgroup,
  boardGroupSort,
  conditionalColor,
  search,
  searchFieldId,
  filterRoot,
  sorts,
  limit,
  hidden,
  dataSourceId,
  filterToMatches,
  openEntity,
}: {
  databaseId: string;
  boardField: string | null;
  boardSubgroup: string | null;
  boardGroupSort: "default" | "count_desc" | "count_asc" | "name_asc";
  conditionalColor: ConditionalColorConfig;
  search: string;
  searchFieldId: string | null;
  filterRoot: FilterGroup;
  sorts: SortRule[];
  limit: number;
  hidden: Set<string>;
  dataSourceId: string | null;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  openEntity: (entity: Entity) => void;
}) {
  const qc = useQueryClient();
  const [dragEntity, setDragEntity] = useState<string | null>(null);
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [columnPages, setColumnPages] = useState<Record<string, number>>({});
  const [visibleGroupCounts, setVisibleGroupCounts] = useState<
    Record<string, number>
  >({});
  const [newCard, setNewCard] = useState<{
    data: Record<string, unknown>;
    pageKey: string;
  } | null>(null);

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () =>
      apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const fields = fieldsQ.data ?? [];
  const byId = Object.fromEntries(fields.map((field) => [field.id, field]));
  const groupable = fields.filter((field) =>
    ["select", "status", "priority", "checkbox", "country"].includes(
      field.type,
    ),
  );
  const field = boardField ? byId[boardField] : groupable[0];
  const subField = boardSubgroup ? byId[boardSubgroup] : undefined;
  const nameField = fields.find((candidate) => candidate.type === "name");
  const pageSize = Math.min(Math.max(limit, 1), 200);
  const baseFilters = useMemo(
    () => [
      ...(dataSourceId
        ? [
            {
              field_id: "data_source_id",
              operator: "eq",
              value: dataSourceId,
            },
          ]
        : []),
    ],
    [dataSourceId],
  );
  const filterTree = useMemo(
    () => serverFilterTreeFor(filterRoot),
    [filterRoot],
  );
  const queryContext = JSON.stringify({
    filters: baseFilters,
    filterTree,
    sorts,
    search: filterToMatches ? search.trim() : "",
    searchFieldId: filterToMatches ? searchFieldId : null,
  });

  const summaryQuery = (groupField: Field | undefined) => ({
    page: 1,
    page_size: 1,
    filters: baseFilters,
    filter_tree: filterTree,
    sorts: sorts.map((sort) => ({
      field_id: sort.fieldId,
      direction: sort.dir,
    })),
    group_by: groupField?.id ?? null,
    search: filterToMatches ? search.trim() || null : null,
    search_field_id: filterToMatches ? searchFieldId : null,
  });
  const groupsQ = useQuery<EntityPage>({
    queryKey: [
      "board-groups",
      databaseId,
      field?.id,
      queryContext,
    ],
    enabled: Boolean(field),
    queryFn: () =>
      apiFetch<EntityPage>(`/databases/${databaseId}/entities/query`, {
        method: "POST",
        body: JSON.stringify(summaryQuery(field)),
      }),
  });
  const swimlanesQ = useQuery<EntityPage>({
    queryKey: [
      "board-swimlanes",
      databaseId,
      subField?.id,
      queryContext,
    ],
    enabled: Boolean(subField),
    queryFn: () =>
      apiFetch<EntityPage>(`/databases/${databaseId}/entities/query`, {
        method: "POST",
        body: JSON.stringify(summaryQuery(subField)),
      }),
  });

  const columns = (() => {
    if (!field) return [];
    const result = columnsForGroups(field, groupsQ.data?.groups ?? []);
    if (boardGroupSort === "count_desc") {
      return [...result].sort((left, right) => right.total - left.total);
    }
    if (boardGroupSort === "count_asc") {
      return [...result].sort((left, right) => left.total - right.total);
    }
    if (boardGroupSort === "name_asc") {
      return [...result].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    }
    return result;
  })();
  const boardContextKey = `${boardField ?? ""}:${boardSubgroup ?? ""}:${queryContext}`;
  const visibleGroupCount =
    visibleGroupCounts[boardContextKey] ?? GROUP_PAGE_SIZE;
  const visibleColumns = columns.slice(0, visibleGroupCount);
  const swimlanes: (Col | null)[] =
    subField
      ? columnsForGroups(subField, swimlanesQ.data?.groups ?? [])
      : [null];

  const pageSpecs = visibleColumns.flatMap((column) =>
    swimlanes.flatMap((sub) => {
      const pageKey = `${boardContextKey}:${sub?.key ?? ""}:${column.key}`;
      const pages = columnPages[pageKey] ?? 1;
      return Array.from({ length: pages }, (_, index) => ({
        column,
        sub,
        pageKey,
        page: index + 1,
      }));
    }),
  );
  const pageQueries = useQueries({
    queries: pageSpecs.map((spec) => ({
      queryKey: [
        "board-group-page",
        databaseId,
        field?.id,
        spec.column.key,
        subField?.id,
        spec.sub?.key,
        spec.page,
        pageSize,
        queryContext,
      ],
      enabled: Boolean(field),
      queryFn: () =>
        apiFetch<EntityPage>(
          `/databases/${databaseId}/entities/query`,
          {
            method: "POST",
            body: JSON.stringify({
              page: spec.page,
              page_size: pageSize,
              filters: [
                ...baseFilters,
                {
                  field_id: field!.id,
                  operator: isEmpty(spec.column.value)
                    ? "is_empty"
                    : "eq",
                  value: spec.column.value,
                },
                ...(subField && spec.sub
                  ? [
                      {
                        field_id: subField.id,
                        operator: isEmpty(spec.sub.value)
                          ? "is_empty"
                          : "eq",
                        value: spec.sub.value,
                      },
                    ]
                  : []),
              ],
              filter_tree: filterTree,
              sorts: sorts.map((sort) => ({
                field_id: sort.fieldId,
                direction: sort.dir,
              })),
              search: filterToMatches ? search.trim() || null : null,
              search_field_id: filterToMatches ? searchFieldId : null,
            }),
          },
        ),
    })),
  });
  const pageData = new Map<string, EntityPage[]>();
  pageSpecs.forEach((spec, index) => {
    const data = pageQueries[index]?.data;
    if (!data) return;
    pageData.set(spec.pageKey, [
      ...(pageData.get(spec.pageKey) ?? []),
      data,
    ]);
  });

  const cardFields = fields
    .filter(
      (candidate) =>
        !hidden.has(candidate.id) &&
        candidate.id !== field?.id &&
        candidate.id !== subField?.id &&
        candidate.id !== nameField?.id &&
        !SKIP_ON_CARD.has(candidate.type),
    )
    .slice(0, 3);

  const invalidateBoard = () => {
    qc.invalidateQueries({ queryKey: ["board-groups", databaseId] });
    qc.invalidateQueries({
      queryKey: ["board-swimlanes", databaseId],
    });
    qc.invalidateQueries({
      queryKey: ["board-group-page", databaseId],
    });
    qc.invalidateQueries({ queryKey: ["entities", databaseId] });
  };
  const save = useMutation({
    mutationFn: ({
      entityId,
      data,
    }: {
      entityId: string;
      data: Record<string, unknown>;
    }) =>
      apiFetch<Entity>(`/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: invalidateBoard,
  });
  const addCard = useMutation({
    mutationFn: ({
      data,
      name,
    }: {
      data: Record<string, unknown>;
      pageKey: string;
      name: string;
    }) =>
      apiFetch<Entity>(`/databases/${databaseId}/entities`, {
        method: "POST",
        body: JSON.stringify({
          name,
          data,
          data_source_id: dataSourceId,
        }),
      }),
    onSuccess: (created) => {
      setEditingEntityId(created.id);
      setNewCard(null);
      invalidateBoard();
    },
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key.toLowerCase() !== "n" ||
        event.metaKey ||
        event.ctrlKey ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        !field
      ) {
        return;
      }
      event.preventDefault();
      const column = columns[0];
      if (!column) return;
      const data: Record<string, unknown> = {};
      if (!NON_SETTABLE.has(field.type)) data[field.id] = column.value;
      setNewCard({ data, pageKey: `:${column.key}` });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columns, field]);

  if (!field) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Open <b>Customize → Board → Group by</b> to choose the column field.
      </div>
    );
  }

  function placement(column: Col, sub?: Col): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (!NON_SETTABLE.has(field!.type)) {
      data[field!.id] = column.value;
    }
    if (subField && sub && !NON_SETTABLE.has(subField.type)) {
      data[subField.id] = sub.value;
    }
    return data;
  }
  function dropOn(column: Col, sub?: Col) {
    if (!dragEntity) return;
    const data = placement(column, sub);
    if (Object.keys(data).length) {
      save.mutate({ entityId: dragEntity, data });
    }
    setDragEntity(null);
  }
  const cardTitle = (entity: Entity) => entity.name || "Untitled";

  const renderCard = (entity: Entity) => {
    const cardColor =
      conditionalColor.target === "groups"
        ? null
        : conditionalColorForEntity(entity, fields, conditionalColor);
    const surface = colorSurface(cardColor);
    return (
      <motion.div
        key={entity.id}
        layout="position"
        draggable={editingEntityId !== entity.id}
        data-drag-highlight
        data-drag-preview-kind="board-card"
        data-drag-preview-label={cardTitle(entity)}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onDragStart={() => setDragEntity(entity.id)}
        style={surface ? { backgroundColor: surface.backgroundColor } : undefined}
        className="group cursor-grab space-y-1.5 rounded-lg border bg-card p-2 text-[11px] leading-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md active:cursor-grabbing"
      >
        <div className="flex items-start gap-1 text-[11px] font-medium">
          <div className="min-w-0 flex-1">
            {nameField ? (
              <CellEditor
                key={editingEntityId === entity.id ? "edit" : "view"}
                field={nameField}
                value={
                  (entity.data as Record<string, unknown>)[nameField.id] ??
                  entity.name
                }
                onCommit={(value) =>
                  save.mutate({
                    entityId: entity.id,
                    data: { [nameField.id]: value },
                  })
                }
                autoEdit={editingEntityId === entity.id}
                onFinish={() => setEditingEntityId(null)}
              />
            ) : (
              cardTitle(entity)
            )}
          </div>
          <button
            type="button"
            draggable={false}
            onClick={() => openEntity(entity)}
            title="Open entity"
            aria-label={`Open ${entity.name}`}
            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <FaIcon name="window-maximize.1" className="size-3.5" />
          </button>
        </div>
        {cardFields.map((cardField) => {
          const value = (entity.data as Record<string, unknown>)[
            cardField.id
          ];
          if (isEmpty(value)) return null;
          return (
            <div
              key={cardField.id}
              className="flex items-center gap-1 text-[10px] leading-4"
            >
              <span className="text-muted-foreground">
                {cardField.name}:
              </span>
              {CHIP_TYPES.has(cardField.type) ? (
                <ValueChip
                  field={cardField}
                  value={Array.isArray(value) ? value[0] : value}
                />
              ) : (
                <span className="truncate">
                  {displayText(cardField, value)}
                </span>
              )}
            </div>
          );
        })}
      </motion.div>
    );
  };

  const renderColumn = (column: Col, sub?: Col) => {
    const pageKey = `${boardContextKey}:${sub?.key ?? ""}:${column.key}`;
    const pages = pageData.get(pageKey) ?? [];
    const cards = mergeUniqueById(...pages.map((page) => page.items));
    const total = pages[0]?.total ?? column.total;
    const loadedPages = columnPages[pageKey] ?? 1;
    const pageCount = pages[pages.length - 1]?.pages ?? 1;
    const loading = pageSpecs.some(
      (spec, index) =>
        spec.pageKey === pageKey && pageQueries[index]?.isLoading,
    );
    const configuredGroupColor =
      conditionalColor.target === "rows"
        ? null
        : conditionalColorForGroup(field, column.value, conditionalColor);
    const columnColor =
      configuredGroupColor ?? column.color ?? choiceColor(field, column.value);
    const surface = colorSurface(columnColor);
    return (
      <div
        key={pageKey}
        onDragOver={(event) => {
          if (dragEntity) event.preventDefault();
        }}
        onDrop={() => dropOn(column, sub)}
        style={
          surface
            ? {
                borderTopColor: surface.borderColor,
                borderTopWidth: 3,
              }
            : undefined
        }
        className="flex h-full min-h-56 w-60 shrink-0 flex-col rounded-lg border bg-muted/25"
      >
        <div
          style={
            surface
              ? { backgroundColor: surface.backgroundColor }
              : undefined
          }
          className="flex h-8 items-center gap-1.5 rounded-t-[7px] px-2"
        >
          {column.chip ? (
            <ValueChip field={field} value={column.value} />
          ) : (
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              {column.label}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {total}
          </span>
          <button
            type="button"
            onClick={() =>
              setNewCard({
                data: placement(column, sub),
                pageKey,
              })
            }
            title={`Create in ${column.label}`}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-background/70 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 pb-1.5 [scrollbar-gutter:stable]">
          {loading && cards.length === 0 ? (
            <div className="h-16 animate-pulse rounded-lg border bg-card/60" />
          ) : null}
          {!loading && cards.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-6 text-center text-[11px] text-muted-foreground">
              Drop a card here or create a new one.
            </div>
          ) : null}
          {cards.map(renderCard)}
          {loadedPages < pageCount ? (
            <button
              type="button"
              onClick={() =>
                setColumnPages((current) => ({
                  ...current,
                  [pageKey]: loadedPages + 1,
                }))
              }
              className="flex h-7 w-full items-center justify-center gap-1 rounded-md border text-[11px] font-medium text-primary hover:bg-primary/10"
            >
              <ChevronDown className="size-3" />
              Load more ({Math.max(0, total - cards.length)})
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              setNewCard({
                data: placement(column, sub),
                pageKey,
              })
            }
            className="flex h-7 w-full items-center gap-1.5 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <Plus className="size-3" /> New
          </button>
        </div>
      </div>
    );
  };

  const hasMoreGroups = visibleGroupCount < columns.length;
  return (
    <div className="relative flex h-full min-h-40 flex-col gap-2 overflow-y-auto">
      <ViewQueryState
        loading={fieldsQ.isLoading || groupsQ.isLoading}
        error={fieldsQ.isError || groupsQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void groupsQ.refetch();
        }}
      />
      {swimlanes.map((sub) => (
        <div
          key={sub?.key ?? "all"}
          className={`flex min-h-0 flex-col gap-1.5 ${
            subField ? "min-h-72" : "flex-1"
          }`}
        >
          {sub ? (
            <div className="flex h-6 items-center gap-2 border-b text-[11px] font-medium">
              {sub.chip ? (
                <ValueChip field={subField!} value={sub.value} />
              ) : (
                <span>{sub.label}</span>
              )}
              <span className="tabular-nums text-muted-foreground">
                {sub.total}
              </span>
            </div>
          ) : null}
          <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1">
            {visibleColumns.map((column) =>
              renderColumn(column, sub ?? undefined),
            )}
            {hasMoreGroups ? (
              <button
                type="button"
                onClick={() =>
                  setVisibleGroupCounts((current) => ({
                    ...current,
                    [boardContextKey]: Math.min(
                      columns.length,
                      visibleGroupCount + GROUP_PAGE_SIZE,
                    ),
                  }))
                }
                className="flex h-full min-h-56 w-28 shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-[11px] font-medium text-primary hover:border-primary/40 hover:bg-primary/5"
              >
                <ChevronDown className="size-4" />
                <span>Load more groups</span>
                <span className="tabular-nums text-muted-foreground">
                  {columns.length - visibleGroupCount} remaining
                </span>
              </button>
            ) : null}
          </div>
        </div>
      ))}
      <EntityNameDialog
        open={Boolean(newCard)}
        pending={addCard.isPending}
        onClose={() => setNewCard(null)}
        onCreate={(name) =>
          newCard && addCard.mutate({ ...newCard, name })
        }
        label="New card"
      />
    </div>
  );
}
