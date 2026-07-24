"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { CellEditor, ValueChip } from "@/components/table/cell-editor";
import { ColumnMenu } from "@/components/table/column-menu";
import { Dropdown } from "@/components/ui/dropdown";
import { FaIcon } from "@/components/ui/fa-icon";
import { IconPicker } from "@/components/ui/icon-picker";
import { countryByCode, parsePhone } from "@/lib/countries";
import { applyFilterTree, applySorts, groupEntities } from "@/lib/view";
import type { SharedViewProps } from "@/components/table/view-shell";
import type { components } from "@/lib/api/schema";
import { formatEntityId } from "@/lib/entity-id";
import { mergeUniqueById } from "@/lib/entity-tree";
import { ViewQueryState } from "@/components/table/view-query-state";
import { defaultIconForFieldType, iconForField } from "@/lib/icon-system";
import {
  calculationForField,
  calculationOptions,
} from "@/lib/calculations";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];
type EntityPage = components["schemas"]["EntityPage"];
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

function formatCalculation(value: unknown, operation: string): string {
  if (value === null || value === undefined) return "—";
  if (operation === "percent_filled") return `${Math.round(Number(value))}%`;
  if (typeof value === "number")
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(value);
}

function cellAlignClass(field: Field) {
  const alignment = (field.options as { alignment?: string }).alignment;
  if (alignment === "center") return "justify-center";
  if (alignment === "right") return "justify-end";
  return "justify-start";
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
  dataSourceId,
  search,
  filterToMatches,
  matchedIds,
  flashId,
  openEntity,
}: { databaseId: string } & SharedViewProps) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [insertAt, setInsertAt] = useState<{ side: "left" | "right"; targetId: string } | null>(null);
  const [newEntityOpen, setNewEntityOpen] = useState(false);
  const [newEntityName, setNewEntityName] = useState("");
  const [newEntityData, setNewEntityData] = useState<Record<string, unknown>>({});
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
  const [dragEntityId, setDragEntityId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editCell, setEditCell] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childShown, setChildShown] = useState<Record<string, number>>({}); // per-parent sub-item window
  const autoExpandedParents = useRef<Set<string>>(new Set());
  const [resizing, setResizing] = useState<{
    fieldId: string;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const [fName, setFName] = useState("");
  const [fType, setFType] = useState("text");
  const [fIcon, setFIcon] = useState(defaultIconForFieldType("text"));
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
  const fieldsById = new Map((fieldsQ.data ?? []).map((field) => [field.id, field]));
  const requestedAggregations = Object.entries(calc).flatMap(
    ([field_id, operation]) => {
      const field = fieldsById.get(field_id);
      const normalized = field
        ? calculationForField(field.type, operation)
        : null;
      return normalized ? [{ field_id, function: normalized }] : [];
    },
  );
  const calcSignature = JSON.stringify(requestedAggregations);
  const entitiesQueryKey = [
    "entities",
    databaseId,
    "infinite",
    pageSize,
    dataSourceId,
    calcSignature,
  ] as const;
  const entitiesQ = useInfiniteQuery<EntityPage>({
    queryKey: entitiesQueryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      apiFetch<EntityPage>(`/databases/${databaseId}/entities/query`, {
        method: "POST",
        body: JSON.stringify({
          page: pageParam,
          page_size: pageSize,
          filters: dataSourceId
            ? [{ field_id: "data_source_id", operator: "eq", value: dataSourceId }]
            : [],
          aggregations: requestedAggregations,
        }),
      }),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined,
  });
  const entityItems = useMemo(
    () =>
      mergeUniqueById(
        ...(entitiesQ.data?.pages.map((page) => page.items) ?? []),
      ),
    [entitiesQ.data?.pages],
  );
  const subOwnerField = (fieldsQ.data ?? []).find(
    (field) =>
      (field.options as { sub_item?: boolean; mirror?: boolean })?.sub_item &&
      !(field.options as { mirror?: boolean })?.mirror,
  );
  const subParentField = (fieldsQ.data ?? []).find(
    (field) =>
      (field.options as { sub_item?: boolean; mirror?: boolean })?.sub_item &&
      (field.options as { mirror?: boolean })?.mirror,
  );
  const loadedEntityIds = useMemo(
    () => entityItems.map((entity) => entity.id),
    [entityItems],
  );
  const subItemTreeQ = useQuery<Entity[]>({
    queryKey: [
      "entities",
      databaseId,
      "sub-item-tree",
      subOwnerField?.id,
      loadedEntityIds,
    ],
    queryFn: () =>
      apiFetch<Entity[]>(
        `/databases/${databaseId}/entities/sub-item-tree`,
        {
          method: "POST",
          body: JSON.stringify({ entity_ids: loadedEntityIds }),
        },
      ),
    enabled:
      Boolean(subOwnerField && subParentField) && loadedEntityIds.length > 0,
  });
  const totalEntities = entitiesQ.data?.pages[0]?.total ?? 0;

  function updateCachedEntities(
    transform: (entities: Entity[]) => Entity[],
    totalDelta = 0,
  ) {
    qc.setQueryData<InfiniteData<EntityPage>>(entitiesQueryKey, (current) => {
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

  function updateCachedSubItemTrees(
    transform: (entities: Entity[]) => Entity[],
  ) {
    qc.setQueriesData<Entity[]>(
      { queryKey: ["entities", databaseId, "sub-item-tree"] },
      (current) => (current ? transform(current) : current),
    );
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fields", databaseId] });
    qc.invalidateQueries({ queryKey: ["entities", databaseId] });
  };

  const addField = useMutation({
    mutationFn: () => {
      const options =
        fType === "relation"
          ? { target_database_id: fTargetDb, two_way: fTwoWay }
          : buildOptions(fType, fOptions, fFormat, fCurrency);
      return apiFetch<Field>(`/databases/${databaseId}/fields`, {
        method: "POST",
        body: JSON.stringify({ name: fName.trim(), type: fType, icon: fIcon, options }),
      });
    },
    onSuccess: async (created) => {
      if (insertAt) {
        const ids = (fieldsQ.data ?? []).map((field) => field.id).filter((id) => id !== created.id);
        const targetIndex = ids.indexOf(insertAt.targetId);
        ids.splice(insertAt.side === "left" ? targetIndex : targetIndex + 1, 0, created.id);
        await apiFetch<void>(`/databases/${databaseId}/fields/reorder`, {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
      }
      setAdding(false);
      setInsertAt(null);
      setFName("");
      setFType("text");
      setFIcon(defaultIconForFieldType("text"));
      setFOptions("");
      setFFormat("integer");
      setFCurrency("VND");
      setFTargetDb(null);
      setFTwoWay(false);
      invalidate();
    },
  });

  const addEntity = useMutation({
    mutationFn: ({ name, data }: { name: string; data: Record<string, unknown> }) =>
      apiFetch<Entity>(`/databases/${databaseId}/entities`, {
        method: "POST",
        body: JSON.stringify({ name, data }),
      }),
    onSuccess: (created) => {
      const title = (fieldsQ.data ?? []).find((f) =>
        ["text", "long_text"].includes(f.type),
      );
      if (title) setEditCell(`${created.id}:${title.id}`);
      setNewEntityName("");
      setNewEntityData({});
      setNewEntityOpen(false);
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
      setNewEntityOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const onInsert = (event: Event) => {
      const detail = (event as CustomEvent<{ targetId?: string; side?: "left" | "right" }>).detail;
      if (!detail?.targetId || !detail.side) return;
      insertField(detail.side, detail.targetId);
    };
    window.addEventListener("vhb:insert-field", onInsert);
    return () => window.removeEventListener("vhb:insert-field", onInsert);
  });

  const deleteEntity = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/entities/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      updateCachedEntities((entities) => entities.filter((entity) => entity.id !== id), -1);
      updateCachedSubItemTrees((entities) =>
        entities.filter((entity) => entity.id !== id),
      );
      qc.invalidateQueries({
        queryKey: ["entities", databaseId, "sub-item-tree"],
      });
      qc.invalidateQueries({ queryKey: ["entities-search", databaseId] });
    },
  });

  const updateCell = useMutation({
    mutationFn: ({
      entityId,
      data,
    }: {
      entityId: string;
      data: Record<string, unknown>;
      relation: boolean;
    }) =>
      apiFetch<Entity>(`/entities/${entityId}`, {
        method: "PATCH",
        body: JSON.stringify({ data }),
      }),
    onSuccess: (updated, variables) => {
      updateCachedEntities((entities) =>
        entities.map((entity) => (entity.id === updated.id ? updated : entity)),
      );
      updateCachedSubItemTrees((entities) =>
        entities.map((entity) => (entity.id === updated.id ? updated : entity)),
      );
      if (variables.relation) {
        qc.invalidateQueries({ queryKey: ["entities", databaseId] });
      }
      qc.invalidateQueries({ queryKey: ["entities-search", databaseId] });
    },
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => apiFetch<void>(`/entities/${id}`, { method: "DELETE" })),
      );
    },
    onSuccess: (_, ids) => {
      setSelected(new Set());
      const deletedIds = new Set(ids);
      updateCachedSubItemTrees((entities) =>
        entities.filter((entity) => !deletedIds.has(entity.id)),
      );
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
    },
  });

  const duplicateEntities = useMutation({
    mutationFn: async (ids: string[]) => {
      const byId = new Map(entityItems.map((r) => [r.id, r]));
      for (const id of ids) {
        const source = byId.get(id);
        await apiFetch<Entity>(`/databases/${databaseId}/entities`, {
          method: "POST",
          body: JSON.stringify({ name: source?.name ?? "Untitled", data: source?.data ?? {} }),
        });
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
    },
  });

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
    let left = 54; // 22 px row-action gutter + 32 px checkbox column
    for (let i = 0; i < colIdx; i++) left += colWidth(list[i]);
    return {
      position: "sticky",
      left,
      // With border-separate each sticky cell is a reliable opaque layer.
      // Keep it above ordinary cells and their local editor overlays.
      zIndex: 10,
      ...(colIdx === frozenUpTo
        ? {
            // An inset divider remains painted by the sticky cell while the
            // scrollable content moves underneath it.
            boxShadow:
              "inset -2px 0 0 var(--control-border-strong), 5px 0 8px rgba(16, 36, 71, 0.08)",
          }
        : {}),
    };
  }
  const checkboxFrozen: React.CSSProperties | undefined =
    frozenUpTo >= 0
      ? {
          position: "sticky",
          left: 22,
          zIndex: 11,
        }
      : undefined;
  const rowGutterFrozen: React.CSSProperties = {
    position: "sticky",
    left: 0,
    zIndex: 12,
  };

  function selectRowFromCheckbox(
    idx: number,
    id: string,
    checked: boolean,
    shift: boolean,
    additive: boolean,
  ) {
    // Checkbox selection is a row-level mode: it clears the active cell/range
    // and replaces an existing row selection unless the user explicitly uses
    // Shift or Cmd/Ctrl.
    setRange(null);
    setEditCell(null);
    const rs = entityItems;
    if (checked && shift && anchor !== null) {
      const [lo, hi] = anchor <= idx ? [anchor, idx] : [idx, anchor];
      setSelected(new Set(rs.slice(lo, hi + 1).map((r) => r.id)));
      setCursor(idx);
    } else if (additive) {
      setSelected((current) => {
        const next = new Set(current);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      });
      if (anchor === null) setAnchor(idx);
      setCursor(idx);
    } else {
      setSelected(checked ? new Set([id]) : new Set());
      setAnchor(idx);
      setCursor(idx);
    }
  }

  // Ctrl/Cmd+Shift+Down/Up extends entity selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.shiftKey)) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const rs = entityItems;
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
  }, [anchor, cursor, entityItems]);

  const reorderFields = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/fields/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });

  const reorderEntities = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/entities/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entities", databaseId] }),
  });

  function insertField(side: "left" | "right", targetId: string) {
    setInsertAt({ side, targetId });
    setFName("");
    setFType("text");
    setFIcon(defaultIconForFieldType("text"));
    setAddAnchor({ x: menu?.x ?? 24, y: menu?.y ?? 96 });
    setAdding(true);
  }

  function moveBefore(ids: string[], fromId: string, toId: string): string[] {
    if (fromId === toId) return ids;
    const arr = ids.filter((i) => i !== fromId);
    const to = arr.indexOf(toId);
    arr.splice(to < 0 ? arr.length : to, 0, fromId);
    return arr;
  }

  const fields = fieldsQ.data ?? [];
  const entities = useMemo(
    () => mergeUniqueById(subItemTreeQ.data ?? [], entityItems),
    [entityItems, subItemTreeQ.data],
  );
  const choiceType = ["select", "multi_select"].includes(fType);

  // View tools: filter → sort → search → optional group.
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  let visible = applySorts(
    applyFilterTree(entities, byId, filterRoot),
    byId,
    sorts,
  );
  const searchActive = search.trim().length > 0;
  if (searchActive && filterToMatches && matchedIds)
    visible = visible.filter((r) => matchedIds.has(r.id));
  let groups =
    groupFieldId && byId[groupFieldId]
      ? groupEntities(visible, byId[groupFieldId])
      : null;
  if (groups && hideEmpty) groups = groups.filter((g) => g.label !== "Empty");
  const displayFields = fields.filter((f) => !hidden.has(f.id));
  const requiredFields = displayFields.filter(
    (field) =>
      (field.options as { required?: boolean }).required === true &&
      (field.options as { system_key?: string }).system_key !== "name" &&
      !["unique_id", "rollup", "formula", "created_time", "created_by", "last_edited_time", "last_edited_by"].includes(field.type),
  );
  const hasRequiredValues = requiredFields.every((field) => {
    const value = newEntityData[field.id];
    if (value === null || value === undefined || value === "") return false;
    return !Array.isArray(value) || value.length > 0;
  });
  const nameFieldId = fields.find(
    (field) => (field.options as { system_key?: string }).system_key === "name",
  )?.id;
  const calcFields = displayFields.filter((field) =>
    calculationForField(field.type, calc[field.id]),
  );
  const subOwner = subOwnerField;
  const subParent = subParentField;
  // Hierarchy mode: when sub-items on and not grouping, show a parent→child tree.
  const treeMode = !!subOwner && !!subParent && !groups;
  const entityById = useMemo(
    () => new Map(visible.map((entity) => [entity.id, entity])),
    [visible],
  );
  const childrenOf = useCallback(
    (entity: Entity): Entity[] => {
      if (!subOwner) return [];
      const ids = (entity.data as Record<string, unknown>)[subOwner.id];
      return Array.isArray(ids)
        ? [...new Set(ids.map(String))]
            .map((id) => entityById.get(id))
            .filter((row): row is Entity => !!row)
        : [];
    },
    [entityById, subOwner],
  );
  // Existing parent rows should reveal their hierarchy on first encounter.
  // Remember them so an intentional user collapse remains respected.
  useEffect(() => {
    const newlyExpandable = visible
      .filter((entity) => childrenOf(entity).length > 0)
      .map((entity) => entity.id)
      .filter((id) => !autoExpandedParents.current.has(id));
    if (!newlyExpandable.length) return;
    newlyExpandable.forEach((id) => autoExpandedParents.current.add(id));
    setExpanded((current) => new Set([...current, ...newlyExpandable]));
  }, [childrenOf, visible]);
  const topLevel = treeMode
    ? visible.filter((r) => {
        const p = (r.data as Record<string, unknown>)[subParent!.id];
        return !Array.isArray(p) || p.length === 0;
      })
    : visible;

  async function addSubEntity(parent: Entity) {
    if (!subOwner) return;
    const child = await apiFetch<Entity>(`/databases/${databaseId}/entities`, {
      method: "POST",
      body: JSON.stringify({ name: "New sub-item", data: {} }),
    });
    const cur = ((parent.data as Record<string, unknown>)[subOwner.id] ??
      []) as string[];
    const updatedParent = await apiFetch<Entity>(`/entities/${parent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ data: { [subOwner.id]: [...cur, child.id] } }),
    });
    setExpanded((p) => new Set(p).add(parent.id));
    // A newly-created child normally falls outside the current server page.
    // Keep it in the active page immediately so hierarchy feedback is instant.
    qc.setQueryData<InfiniteData<EntityPage>>(entitiesQueryKey, (current) => {
      if (!current) return current;
      const childWithParent: Entity = {
        ...child,
        data: {
          ...child.data,
          ...(subParent ? { [subParent.id]: [parent.id] } : {}),
        },
      };
      return {
        ...current,
        pages: current.pages.map((page, pageIndex) => {
          const total = page.total + 1;
          return {
            ...page,
            total,
            pages: Math.ceil(total / page.page_size),
            items: [
              ...page.items.map((item) =>
                item.id === parent.id ? updatedParent : item,
              ),
              ...(pageIndex === 0 &&
              !page.items.some((item) => item.id === child.id)
                ? [childWithParent]
                : []),
            ],
          };
        }),
      };
    });
  }

  // Commit a cell; setting a Country auto-fills phone dial codes in the entity.
  function commitCell(entity: Entity, field: Field, value: unknown) {
    const data: Record<string, unknown> = { [field.id]: value };
    if (field.type === "country" && typeof value === "string" && value) {
      const c = countryByCode(value);
      if (c) {
        for (const f of fields) {
          if (f.type !== "phone") continue;
          const cur = (entity.data as Record<string, unknown>)[f.id];
          const number = parsePhone(typeof cur === "string" ? cur : "").number;
          data[f.id] = `+${c.dial}${number ? " " + number : ""}`;
        }
      }
    }
    updateCell.mutate({
      entityId: entity.id,
      data,
      relation: field.type === "relation",
    });
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

  function rangeEdges(r: number, c: number) {
    if (!range || !inRange(r, c)) return null;
    const [r1, r2] = [Math.min(range.r1, range.r2), Math.max(range.r1, range.r2)];
    const [c1, c2] = [Math.min(range.c1, range.c2), Math.max(range.c1, range.c2)];
    return {
      top: r === r1,
      right: c === c2,
      bottom: r === r2,
      left: c === c1,
    };
  }

  function cellText(f: Field, entity: Entity): string {
    if (f.type === "unique_id") {
      return formatEntityId(entity, f);
    }
    const v = (entity.data as Record<string, unknown>)[f.id];
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
        const entity = range.r2;
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
          const nr = Math.max(0, Math.min(visible.length - 1, entity + move[0]));
          const nc = Math.max(
            0,
            Math.min(displayFields.length - 1, col + move[1]),
          );
          setRange({ r1: nr, c1: nc, r2: nr, c2: nc });
          setEditCell(null);
          return;
        }
        if (e.key === "Enter") {
          const r = visible[entity];
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
        const rs = entityItems;
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
          .map((entity) =>
            fs
              .slice(c1, c2 + 1)
              .map((f) => cellText(f, entity))
              .join("\t"),
          )
          .join("\n");
        void navigator.clipboard?.writeText(tsv);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [range, entityItems, fieldsQ.data, visible, displayFields]);

  function finishCell(
    entityIdx: number,
    colIdx: number,
    move?: "down" | "next" | "previous",
  ) {
    setEditCell(null);
    if (!move || visible.length === 0 || displayFields.length === 0) return;
    let nr = entityIdx;
    let nc = colIdx;
    if (move === "down") nr = Math.min(visible.length - 1, entityIdx + 1);
    else if (move === "next") {
      nc += 1;
      if (nc >= displayFields.length) {
        nc = 0;
        nr = Math.min(visible.length - 1, entityIdx + 1);
      }
    } else {
      nc -= 1;
      if (nc < 0) {
        nc = displayFields.length - 1;
        nr = Math.max(0, entityIdx - 1);
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

  function renderEntity(entity: Entity, idx: number, depth = 0) {
    const kids = childrenOf(entity);
    const isOpen = expanded.has(entity.id);
    const isRowSelected = selected.has(entity.id);
    return (
      <tr
        key={entity.id}
        data-entity-id={entity.id}
        data-flash={flashId === entity.id || undefined}
        data-search-match={
          (searchActive && !filterToMatches && matchedIds?.has(entity.id)) ||
          undefined
        }
        onDragOver={(event) => dragEntityId && event.preventDefault()}
        onDrop={() => {
          if (!dragEntityId) return;
          reorderEntities.mutate(
            moveBefore(entities.map((row) => row.id), dragEntityId, entity.id),
          );
          setDragEntityId(null);
        }}
        className={`group h-[30px] ${
          flashId === entity.id
            ? "bg-primary/20"
            : searchActive && !filterToMatches && matchedIds?.has(entity.id)
              ? "bg-primary/5"
              : isRowSelected
                ? "row-selected"
                : ""
        }`}
      >
        <td
          className="vhb-frozen-cell w-[22px] border-0 p-0 text-center align-middle"
          style={rowGutterFrozen}
        >
          <button
            type="button"
            draggable
            onDragStart={() => setDragEntityId(entity.id)}
            onDragEnd={() => setDragEntityId(null)}
            title="Drag to reorder row"
            aria-label={`Reorder ${entity.name}`}
            className="flex h-full w-full cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-2.5" />
          </button>
        </td>
        <td
          className="vhb-frozen-cell whitespace-nowrap border-r border-border/70 p-0 text-center align-middle"
          style={checkboxFrozen}
        >
          <input
            type="checkbox"
            checked={selected.has(entity.id)}
            onChange={() => {}}
            onClick={(event) =>
              selectRowFromCheckbox(
                idx,
                entity.id,
                event.currentTarget.checked,
                event.shiftKey,
                event.metaKey || event.ctrlKey,
              )
            }
            className="mx-auto block size-3.5 accent-[var(--color-primary)]"
          />
        </td>
        {displayFields.map((f, colIdx) => {
          const cellKey = `${entity.id}:${f.id}`;
          const isEditing = editCell === cellKey;
          const frozenCellStyle = frozenStyle(colIdx);
          const isCellSelected = inRange(idx, colIdx);
          const selectionEdges = rangeEdges(idx, colIdx);
          const selectionBorder = selectionEdges
            ? [
                typeof frozenCellStyle?.boxShadow === "string"
                  ? frozenCellStyle.boxShadow
                  : "",
                selectionEdges.top ? "inset 0 2px 0 var(--color-primary)" : "",
                selectionEdges.right ? "inset -2px 0 0 var(--color-primary)" : "",
                selectionEdges.bottom ? "inset 0 -2px 0 var(--color-primary)" : "",
                selectionEdges.left ? "inset 2px 0 0 var(--color-primary)" : "",
              ]
                .filter(Boolean)
                .join(", ")
            : undefined;
          return (
            <td
              key={f.id}
              onMouseDown={() => {
                if (isEditing) return; // editing this cell: let the input handle it
                setSelected(new Set());
                setAnchor(null);
                setCursor(null);
                setEditCell(null);
                setRange({ r1: idx, c1: colIdx, r2: idx, c2: colIdx });
                setDragging(true);
              }}
              onMouseEnter={() => {
                if (dragging)
                  setRange((r) => (r ? { ...r, r2: idx, c2: colIdx } : r));
              }}
              style={
                isCellSelected
                  ? {
                      ...(frozenCellStyle ?? {}),
                      // A normal scrolling cell must stay below the frozen pane.
                      // Only a selected frozen cell needs a local stacking lift.
                      ...(frozenCellStyle ? { zIndex: 13 } : {}),
                      boxShadow: selectionBorder,
                    }
                  : frozenCellStyle
              }
              className={`overflow-hidden border-r border-border/70 px-1 align-middle ${
                frozenCellStyle ? "vhb-frozen-cell" : ""
              }`}
            >
              <div
                className={`flex min-h-[29px] items-center ${cellAlignClass(f)}`}
                style={
                  treeMode && f.id === nameFieldId
                    ? { paddingLeft: depth * 18 }
                    : undefined
                }
              >
                {treeMode && f.id === nameFieldId && (
                  <>
                    <button
                      onClick={() => kids.length && toggleExpand(entity.id)}
                      className={`mr-0.5 shrink-0 ${kids.length ? "text-muted-foreground hover:text-foreground" : "invisible"}`}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => addSubEntity(entity)}
                      title="Add sub-item"
                      className="mr-1 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:opacity-100 hover:text-primary focus-visible:opacity-100 focus-visible:text-primary"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </>
                )}
                <div className="relative min-w-0 flex-1">
                  {f.type === "unique_id" ? (
                    <span className="px-1.5 text-[11px] text-muted-foreground">
                      {formatEntityId(entity, f)}
                    </span>
                  ) : (
                    <CellEditor
                      key={isEditing ? "edit" : "view"}
                      field={f}
                      databaseId={databaseId}
                      entityId={entity.id}
                      value={(entity.data as Record<string, unknown>)[f.id] ?? null}
                      onCommit={(v) => commitCell(entity, f, v)}
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
                  {f.id === nameFieldId ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEntity(entity);
                      }}
                      title="Open entity"
                      aria-label={`Open ${entity.name}`}
                      className="absolute right-1 top-0.5 z-[3] flex size-5 items-center justify-center rounded bg-card/90 text-muted-foreground opacity-0 shadow-sm hover:bg-muted hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <FaIcon name="window-maximize.1" className="size-2.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            </td>
          );
        })}
        <td className="whitespace-nowrap border-l border-border/70 px-1 text-center">
          <button
            onClick={() => deleteEntity.mutate(entity.id)}
            title="Delete entity"
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="inline size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </td>
      </tr>
    );
  }

  // Recursive render for tree (sub-item) mode. Each parent shows up to 5
  // children at a time with a "Load more sub-items" entity.
  const CHILD_PAGE = 5;
  function renderTree(
    entitiesToRender: Entity[],
    depth: number,
    counter: { i: number },
    visited: Set<string>,
  ): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const entity of entitiesToRender) {
      if (visited.has(entity.id)) continue;
      visited.add(entity.id);
      counter.i += 1;
      out.push(renderEntity(entity, counter.i, depth));
      if (expanded.has(entity.id)) {
        const kids = childrenOf(entity);
        const cShown = childShown[entity.id] ?? CHILD_PAGE;
        out.push(
          ...renderTree(
            kids.slice(0, cShown),
            depth + 1,
            counter,
            visited,
          ),
        );
        if (kids.length > cShown) {
          out.push(
            <tr key={`submore-${entity.id}`}>
              <td colSpan={displayFields.length + 3} className="p-0">
                <button
                  onClick={() =>
                    setChildShown((s) => ({ ...s, [entity.id]: cShown + CHILD_PAGE }))
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
    <div className="relative flex h-full min-h-0 flex-col gap-2">
      <ViewQueryState
        loading={fieldsQ.isLoading || entitiesQ.isLoading}
        error={fieldsQ.isError || entitiesQ.isError}
        onRetry={() => {
          void fieldsQ.refetch();
          void entitiesQ.refetch();
        }}
      />
      {/* Add field popover */}
      {adding &&
        addAnchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setAdding(false);
                setInsertAt(null);
              }}
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
              <div className="flex items-center gap-2">
                <IconPicker
                  value={fIcon}
                  onChange={setFIcon}
                  label="Choose column icon"
                  color="var(--icon-field-text)"
                />
                <input
                  autoFocus
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="Column name"
                  className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <Dropdown
                value={fType}
                allowClear={false}
                options={FIELD_TYPES.map((t) => ({
                  value: t.value,
                  label: t.label,
                }))}
                onChange={(v) => {
                  if (!v) return;
                  setFType(v);
                  setFIcon(defaultIconForFieldType(v as Field["type"]));
                }}
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
                  onClick={() => {
                    setAdding(false);
                    setInsertAt(null);
                  }}
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
            onClick={() => duplicateEntities.mutate([...selected])}
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
      <div className="min-h-0 flex-1 overflow-auto overscroll-none rounded-xl border bg-card [scrollbar-gutter:stable] [&_.vhb-cell-checkbox]:!size-3.5 [&_.vhb-cell-display]:!min-h-7 [&_.vhb-cell-display]:!px-1.5 [&_.vhb-cell-display]:!py-0 [&_.vhb-cell-display]:!text-[11px] [&_.vhb-cell-input]:!min-h-7 [&_.vhb-cell-input]:!px-1.5 [&_.vhb-cell-input]:!py-0 [&_.vhb-cell-input]:!text-[11px]">
        <table
          className="vhb-data-grid table-fixed select-none border-separate border-spacing-0 text-[11px]"
          style={{
            width: 22 + 32 + displayFields.reduce((s, f) => s + colWidth(f), 0) + 40,
          }}
        >
          <colgroup>
            <col style={{ width: 22 }} />
            <col style={{ width: 32 }} />
            {displayFields.map((f) => (
              <col key={f.id} style={{ width: colWidth(f) }} />
            ))}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="bg-muted/40">
              <th
                aria-hidden="true"
                className="vhb-frozen-cell h-8 w-[22px] border-0 p-0"
                style={{ ...rowGutterFrozen, zIndex: 12 }}
              />
              <th
                className="vhb-frozen-cell h-8 border-r border-border p-0 align-middle"
                style={checkboxFrozen}
              >
                <input
                  type="checkbox"
                  checked={entities.length > 0 && selected.size === entities.length}
                  onChange={(e) => {
                    setRange(null);
                    setEditCell(null);
                    setAnchor(null);
                    setCursor(null);
                    setSelected(
                      e.target.checked
                        ? new Set(entities.map((r) => r.id))
                        : new Set(),
                    );
                  }}
                  className="mx-auto block size-3.5 accent-[var(--color-primary)]"
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
                  className={`relative h-8 border-r border-border px-2 py-1 font-medium ${
                    frozenStyle(colIdx) ? "vhb-frozen-cell" : ""
                  } ${
                    (f.options as { alignment?: string }).alignment === "center"
                      ? "text-center"
                      : (f.options as { alignment?: string }).alignment === "right"
                        ? "text-right"
                        : "text-left"
                  }`}
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
                  className={`flex w-full cursor-grab items-center gap-1 truncate hover:text-primary active:cursor-grabbing ${cellAlignClass(f)}`}
                >
                    <FaIcon
                      name={iconForField(f)}
                      className="size-3 shrink-0 text-[var(--icon-field-text)]"
                    />
                    {f.name}
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
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/40"
                  />
                </th>
              ))}
              <th className="h-8 w-10 border-l border-border px-1 py-1">
                <button
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setAddAnchor({ x: r.left - 240, y: r.bottom + 4 });
                    setInsertAt(null);
                    setAdding(true);
                  }}
                  title="Add column"
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-3" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {treeMode && renderTree(topLevel, 0, { i: -1 }, new Set())}
            {!treeMode &&
              !groups &&
              visible.map((entity, idx) => renderEntity(entity, idx))}
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
                          <td colSpan={displayFields.length + 3} className="p-0">
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
                              {g.entities.length}
                            </span>
                          </button>
                        </td>
                      </tr>
                      {!isCollapsed &&
                        g.entities.map((entity) => {
                          i += 1;
                          return renderEntity(entity, i);
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

      {/* One compact footer keeps pagination, creation and calculations together. */}
      <div className="flex h-[26px] shrink-0 items-center gap-1.5 bg-background px-2 text-[10px]">
        {entitiesQ.hasNextPage && (
          <button
            type="button"
            onClick={() => entitiesQ.fetchNextPage()}
            disabled={entitiesQ.isFetchingNextPage}
            className="flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium text-primary hover:bg-primary/10 disabled:opacity-60"
          >
            <ChevronDown
              className={`size-2.5 ${entitiesQ.isFetchingNextPage ? "animate-bounce" : ""}`}
            />
            {entitiesQ.isFetchingNextPage
              ? "Loading…"
              : `Load more (${Math.max(totalEntities - entityItems.length, 0)} left)`}
          </button>
        )}
        <button
          onClick={() => setNewEntityOpen(true)}
          disabled={fields.length === 0 || addEntity.isPending}
          title="Create a new entity (N)"
          className="flex h-5 items-center gap-1 rounded border px-1.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus className="size-2.5" /> New <kbd className="text-[8px] opacity-60">N</kbd>
        </button>
        <div className="ml-1 flex h-5 min-w-0 flex-1 items-center gap-x-5 overflow-x-auto rounded border bg-muted/20 px-2">
          {calcFields.map((f) => {
            const operation = calculationForField(f.type, calc[f.id]);
            if (!operation) return null;
            return (
              <span key={f.id} className="flex shrink-0 items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{f.name}</span>
                <span className="text-[10px] font-bold">
                  {formatCalculation(
                    entitiesQ.data?.pages[0]?.aggregates?.[
                      `${operation}:${f.id}`
                    ],
                    operation,
                  )}
                </span>
              </span>
            );
          })}
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            Showing {entityItems.length} of {totalEntities} records
          </span>
        </div>
      </div>

      {newEntityOpen &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/25 p-4 pt-[18vh]">
            <button
              type="button"
              aria-label="Close new entity dialog"
              className="absolute inset-0"
              onClick={() => setNewEntityOpen(false)}
            />
            <form
              className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newEntityName.trim();
                if (name && hasRequiredValues) addEntity.mutate({ name, data: newEntityData });
              }}
            >
              <h2 className="text-base font-semibold">New entity</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Name is required. UID will be generated automatically.
              </p>
              <input
                autoFocus
                required
                value={newEntityName}
                onChange={(event) => setNewEntityName(event.target.value)}
                placeholder="Entity name"
                className="mt-4 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              {requiredFields.length ? (
                <div className="mt-4 space-y-3 border-t pt-4">
                  <p className="text-xs font-semibold text-muted-foreground">Required properties</p>
                  {requiredFields.map((field) => (
                    <label key={field.id} className="block space-y-1.5">
                      <span className="text-xs font-medium">{field.name}</span>
                      <div className="rounded-md border bg-background">
                        <CellEditor
                          field={field}
                          databaseId={databaseId}
                          value={newEntityData[field.id] ?? null}
                          onCommit={(value) =>
                            setNewEntityData((current) => ({ ...current, [field.id]: value }))
                          }
                        />
                      </div>
                    </label>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Complete all required properties to create this entity.
                  </p>
                </div>
              ) : null}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewEntityOpen(false)}
                  className="rounded-md px-3 py-2 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newEntityName.trim() || !hasRequiredValues || addEntity.isPending}
                  className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {addEntity.isPending ? "Creating…" : "Create entity"}
                </button>
              </div>
            </form>
          </div>,
          document.body,
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
          calcValue={
            calculationForField(menu.field.type, calc[menu.field.id]) ?? ""
          }
          setCalc={(v) => setCalc((c) => ({ ...c, [menu.field.id]: v }))}
          calcOptions={calculationOptions(menu.field.type)}
        />
      )}

    </div>
  );
}
