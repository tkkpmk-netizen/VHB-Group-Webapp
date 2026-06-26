"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Group as GroupIcon,
  Layers,
  ListFilter,
  ListOrdered,
  GripVertical,
  Star,
  Table,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { FieldConfig } from "@/components/table/field-config";
import {
  FilterGroupEditor,
  GroupEditor,
  SortEditor,
} from "@/components/table/view-tools";
import { countRules, type FilterGroup, type SortRule } from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type View = components["schemas"]["ViewOut"];
type Page =
  | "main"
  | "view"
  | "views"
  | "visibility"
  | "filter"
  | "sort"
  | "group"
  | "fields";

const LAYOUTS: { value: View["type"]; label: string }[] = [
  { value: "table", label: "Table" },
  { value: "board", label: "Board" },
  { value: "calendar", label: "Calendar" },
  { value: "gallery", label: "Gallery" },
  { value: "gantt", label: "Timeline" },
];

export function SettingsSidebar({
  databaseId,
  viewId,
  viewType,
  activeId,
  setActiveId,
  fields,
  hidden,
  setHidden,
  hasSubItems,
  onToggleSubItems,
  boardField,
  setBoardField,
  boardSubgroup,
  setBoardSubgroup,
  limit,
  setLimit,
  filterRoot,
  setFilterRoot,
  sorts,
  setSorts,
  groupFieldId,
  setGroupFieldId,
  hideEmpty,
  setHideEmpty,
  initialPage = "main",
  onClose,
}: {
  databaseId: string;
  viewId: string;
  viewType: string;
  activeId: string;
  setActiveId: (id: string) => void;
  fields: Field[];
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  hasSubItems: boolean;
  onToggleSubItems: (enabled: boolean) => void;
  boardField: string | null;
  setBoardField: (id: string | null) => void;
  boardSubgroup: string | null;
  setBoardSubgroup: (id: string | null) => void;
  limit: number;
  setLimit: (n: number) => void;
  filterRoot: FilterGroup;
  setFilterRoot: (g: FilterGroup) => void;
  sorts: SortRule[];
  setSorts: (s: SortRule[]) => void;
  groupFieldId: string | null;
  setGroupFieldId: (id: string | null) => void;
  hideEmpty: boolean;
  setHideEmpty: (b: boolean) => void;
  initialPage?: Page;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState<Page>(initialPage);
  const [editFieldId, setEditFieldId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [renameView, setRenameView] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelView, setConfirmDelView] = useState<string | null>(null);
  const [dragViewId, setDragViewId] = useState<string | null>(null);

  // --- View management (Views page) ---
  const viewsQ = useQuery<View[]>({
    queryKey: ["views", databaseId],
    queryFn: () => apiFetch<View[]>(`/databases/${databaseId}/views`),
  });
  const views = viewsQ.data ?? [];
  const invalidateViews = () =>
    qc.invalidateQueries({ queryKey: ["views", databaseId] });

  const patchView = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch<View>(`/views/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      setRenameView(null);
      invalidateViews();
    },
  });
  const createView = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<View>(`/databases/${databaseId}/views`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: invalidateViews, // stay on current view; the copy appears in the list
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/views/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      setConfirmDelView(null);
      if (id === activeId) {
        const next = views.find((v) => v.id !== id);
        if (next) setActiveId(next.id);
      }
      invalidateViews();
    },
  });
  const reorderViews = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/views/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: invalidateViews,
  });
  function moveView(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = views.map((v) => v.id).filter((i) => i !== fromId);
    const to = ids.indexOf(toId);
    ids.splice(to < 0 ? ids.length : to, 0, fromId);
    reorderViews.mutate(ids);
  }
  function setDefaultView(id: string) {
    // Default = first view; move it to the front.
    const ids = [id, ...views.map((v) => v.id).filter((i) => i !== id)];
    reorderViews.mutate(ids);
  }
  function duplicateView(v: View) {
    createView.mutate({ name: `${v.name} copy`, type: v.type, config: v.config });
  }

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<void>(`/databases/${databaseId}/fields/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/fields/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      setEditFieldId(null);
      setPage("fields");
    },
  });

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = fields.map((f) => f.id).filter((i) => i !== fromId);
    const to = ids.indexOf(toId);
    ids.splice(to, 0, fromId);
    reorder.mutate(ids);
  }

  const shownCount = fields.filter((f) => !hidden.has(f.id)).length;
  const groupField = fields.find((f) => f.id === groupFieldId);
  const editField = fields.find((f) => f.id === editFieldId);

  const header = (title: string, back?: () => void) => (
    <div className="flex items-center gap-2 border-b px-4 py-3">
      {back && (
        <button onClick={back} className="rounded p-1 hover:bg-muted">
          <ChevronLeft className="size-4" />
        </button>
      )}
      <h2 className="flex-1 font-semibold">{title}</h2>
      <button onClick={onClose} className="rounded p-1 hover:bg-muted">
        <X className="size-4" />
      </button>
    </div>
  );

  const row = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    right?: React.ReactNode,
  ) => (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {right}
        <ChevronRight className="size-4" />
      </span>
    </button>
  );

  let body: React.ReactNode;
  if (editField) {
    body = (
      <>
        {header(editField.name, () => setEditFieldId(null))}
        <div className="flex-1 overflow-y-auto p-3">
          <FieldConfig key={editField.id} field={editField} databaseId={databaseId} />
          <button
            onClick={() => del.mutate(editField.id)}
            className="mt-3 flex w-full items-center gap-2 border-t pt-3 text-sm text-destructive hover:opacity-80"
          >
            <Trash2 className="size-4" /> Delete field
          </button>
        </div>
      </>
    );
  } else if (page === "main") {
    body = (
      <>
        {header("View settings")}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          <label className="mb-1 flex items-center gap-3 rounded-md px-2 py-2 text-sm">
            <span className="text-muted-foreground">
              <ListOrdered className="size-4" />
            </span>
            <span className="flex-1">Load limit</span>
            <div className="w-28">
              <Dropdown
                value={String(limit)}
                allowClear={false}
                options={[10, 20, 50, 100, 200].map((n) => ({
                  value: String(n),
                  label: `${n} rows`,
                }))}
                onChange={(v) => v && setLimit(Number(v))}
              />
            </div>
          </label>
          {viewType === "board" && (
            <div className="mb-1 space-y-2 rounded-lg border bg-muted/30 p-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Board
              </p>
              <label className="block text-xs text-muted-foreground">
                Group by (columns)
                <Dropdown
                  value={boardField}
                  placeholder="First Select field"
                  options={fields.map((f) => ({ value: f.id, label: f.name }))}
                  onChange={setBoardField}
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Sub-group (swimlanes)
                <Dropdown
                  value={boardSubgroup}
                  placeholder="None"
                  options={fields
                    .filter((f) => f.id !== boardField)
                    .map((f) => ({ value: f.id, label: f.name }))}
                  onChange={setBoardSubgroup}
                />
              </label>
            </div>
          )}
          {row(
            <Table className="size-4" />,
            "Layout",
            () => setPage("view"),
            LAYOUTS.find((l) => l.value === viewType)?.label,
          )}
          {row(<Layers className="size-4" />, "Views", () => setPage("views"), String(views.length))}
          {row(<Eye className="size-4" />, "Property visibility", () => setPage("visibility"), String(shownCount))}
          {row(<ListFilter className="size-4" />, "Filter", () => setPage("filter"), countRules(filterRoot) ? String(countRules(filterRoot)) : undefined)}
          {row(<ArrowUpDown className="size-4" />, "Sort", () => setPage("sort"), sorts.length ? String(sorts.length) : undefined)}
          {row(<GroupIcon className="size-4" />, "Group", () => setPage("group"), groupField?.name)}
          {row(<ListOrdered className="size-4" />, "Edit properties", () => setPage("fields"))}
          <div className="my-1 border-t" />
          <label className="flex items-center gap-3 rounded-md px-2 py-2 text-sm">
            <span className="text-muted-foreground">
              <GitBranch className="size-4" />
            </span>
            <span className="flex-1">Sub-items</span>
            <input
              type="checkbox"
              checked={hasSubItems}
              onChange={(e) => onToggleSubItems(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
            />
          </label>
        </div>
      </>
    );
  } else if (page === "view") {
    // Layout = the current view's type.
    body = (
      <>
        {header("Layout", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="px-1 pb-1 text-xs text-muted-foreground">
            Choose how this view displays its rows.
          </p>
          {LAYOUTS.map((l) => {
            const isCurrent = l.value === viewType;
            const supported = l.value === "table" || l.value === "board";
            return (
              <button
                key={l.value}
                disabled={!supported}
                onClick={() =>
                  !isCurrent && patchView.mutate({ id: viewId, body: { type: l.value } })
                }
                className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm ${
                  isCurrent
                    ? "bg-primary/10 text-primary"
                    : supported
                      ? "hover:bg-muted"
                      : "text-muted-foreground opacity-50"
                }`}
              >
                <Table className="size-4" /> {l.label}
                {isCurrent && <span className="ml-auto text-xs">current</span>}
                {!supported && <span className="ml-auto text-xs">soon</span>}
              </button>
            );
          })}
        </div>
      </>
    );
  } else if (page === "views") {
    body = (
      <>
        {header("Views", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {views.map((v) => (
            <div
              key={v.id}
              draggable
              onDragStart={() => setDragViewId(v.id)}
              onDragOver={(e) => dragViewId && e.preventDefault()}
              onDrop={() => {
                if (dragViewId) moveView(dragViewId, v.id);
                setDragViewId(null);
              }}
              className={`rounded-md ${v.id === activeId ? "bg-muted" : "hover:bg-muted"}`}
            >
              <div className="flex items-center gap-1 px-1 py-1.5">
                <GripVertical className="size-3.5 cursor-grab text-muted-foreground" />
                {renameView?.id === v.id ? (
                  <input
                    autoFocus
                    value={renameView.name}
                    onChange={(e) => setRenameView({ id: v.id, name: e.target.value })}
                    onBlur={() =>
                      renameView.name.trim()
                        ? patchView.mutate({ id: v.id, body: { name: renameView.name.trim() } })
                        : setRenameView(null)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenameView(null);
                    }}
                    className="flex-1 rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <button
                    onClick={() => setActiveId(v.id)}
                    onDoubleClick={() => setRenameView({ id: v.id, name: v.name })}
                    className="flex-1 truncate text-left text-sm"
                  >
                    {v.name}
                    <span className="ml-1 text-xs capitalize text-muted-foreground">
                      {v.type}
                    </span>
                  </button>
                )}
                <button
                  onClick={() => setDefaultView(v.id)}
                  title="Set as default"
                  className={`rounded p-1 hover:bg-accent ${
                    views[0]?.id === v.id ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Star className="size-3.5" />
                </button>
                <button
                  onClick={() => duplicateView(v)}
                  title="Duplicate"
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  onClick={() => setConfirmDelView(v.id)}
                  disabled={views.length <= 1}
                  title="Delete view"
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              {confirmDelView === v.id && (
                <div className="flex items-center justify-end gap-2 px-2 pb-2 text-xs">
                  <span className="mr-auto text-muted-foreground">Delete this view?</span>
                  <button
                    onClick={() => setConfirmDelView(null)}
                    className="rounded px-2 py-1 hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteView.mutate(v.id)}
                    className="rounded bg-destructive px-2 py-1 font-medium text-destructive-foreground hover:opacity-90"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
          <p className="px-2 pt-2 text-xs text-muted-foreground">
            ⭐ first view = default · drag to reorder · double-click to rename.
          </p>
        </div>
      </>
    );
  } else if (page === "visibility") {
    const filtered = fields.filter((f) =>
      f.name.toLowerCase().includes(search.toLowerCase()),
    );
    body = (
      <>
        {header("Property visibility", () => setPage("main"))}
        <div className="flex-1 overflow-y-auto p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for a property…"
            className="mb-3 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Properties
            </span>
            <button
              onClick={() => setHidden(new Set(fields.map((f) => f.id)))}
              className="text-xs text-primary hover:underline"
            >
              Hide all
            </button>
          </div>
          <div className="space-y-1">
            {filtered.map((f) => {
              const isHidden = hidden.has(f.id);
              return (
                <div
                  key={f.id}
                  draggable
                  onDragStart={() => setDragId(f.id)}
                  onDragOver={(e) => dragId && e.preventDefault()}
                  onDrop={() => {
                    if (dragId) move(dragId, f.id);
                    setDragId(null);
                  }}
                  className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted"
                >
                  <GripVertical className="size-3.5 cursor-grab text-muted-foreground" />
                  <span className="flex-1 text-sm">
                    {f.name}
                    <span className="ml-1 text-xs text-muted-foreground">{f.type}</span>
                  </span>
                  <button
                    onClick={() => {
                      const next = new Set(hidden);
                      if (next.has(f.id)) next.delete(f.id);
                      else next.add(f.id);
                      setHidden(next);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  } else if (page === "filter") {
    body = (
      <>
        {header("Filter", () => setPage("main"))}
        <div className="flex-1 overflow-y-auto p-3">
          <FilterGroupEditor group={filterRoot} fields={fields} onChange={setFilterRoot} />
        </div>
      </>
    );
  } else if (page === "sort") {
    body = (
      <>
        {header("Sort", () => setPage("main"))}
        <div className="flex-1 overflow-y-auto p-3">
          <SortEditor fields={fields} sorts={sorts} setSorts={setSorts} />
        </div>
      </>
    );
  } else if (page === "group") {
    body = (
      <>
        {header("Group", () => setPage("main"))}
        <div className="flex-1 overflow-y-auto p-3">
          <GroupEditor
            fields={fields}
            groupFieldId={groupFieldId}
            setGroupFieldId={setGroupFieldId}
            hideEmpty={hideEmpty}
            setHideEmpty={setHideEmpty}
          />
        </div>
      </>
    );
  } else {
    // fields list (Edit properties)
    body = (
      <>
        {header("Edit properties", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {fields.map((f) => (
            <button
              key={f.id}
              onClick={() => setEditFieldId(f.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
            >
              <span className="flex-1 text-left">
                {f.name}
                <span className="ml-1 text-xs text-muted-foreground">{f.type}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </>
    );
  }

  // In-flow right panel (ClickUp-style) — sits beside the table, never covering
  // the top bar. The parent lays it out in a flex row.
  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-sm">
      {body}
    </div>
  );
}
