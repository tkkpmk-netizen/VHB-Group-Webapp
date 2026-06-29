"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  GitBranch,
  Group as GroupIcon,
  ListFilter,
  ListOrdered,
  GripVertical,
  Plus,
  Table,
  Trash2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { DATE_FORMATS } from "@/components/table/gantt-view";
import { FieldConfig } from "@/components/table/field-config";
import {
  FilterGroupEditor,
  GroupEditor,
  SortEditor,
} from "@/components/table/view-tools";
import { countRules, type FilterGroup, type SortRule } from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Page = "main" | "view" | "visibility" | "filter" | "sort" | "group" | "fields";

export function SettingsSidebar({
  databaseId,
  viewType,
  fields,
  hidden,
  setHidden,
  hasSubItems,
  onToggleSubItems,
  boardField,
  setBoardField,
  boardSubgroup,
  setBoardSubgroup,
<<<<<<< Updated upstream
=======
  ganttDateFormat,
  setGanttDateFormat,
  limit,
  setLimit,
>>>>>>> Stashed changes
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
  viewType: string;
  fields: Field[];
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  hasSubItems: boolean;
  onToggleSubItems: (enabled: boolean) => void;
  boardField: string | null;
  setBoardField: (id: string | null) => void;
  boardSubgroup: string | null;
  setBoardSubgroup: (id: string | null) => void;
<<<<<<< Updated upstream
=======
  ganttDateFormat: string;
  setGanttDateFormat: (f: string) => void;
  limit: number;
  setLimit: (n: number) => void;
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
          {row(<Table className="size-4" />, "Layout / View", () => setPage("view"), "Table")}
=======
          {viewType === "gantt" && (
            <div className="mb-1 space-y-2 rounded-lg border bg-muted/30 p-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Timeline
              </p>
              <label className="block text-xs text-muted-foreground">
                Định dạng ngày
                <Dropdown
                  value={ganttDateFormat}
                  options={DATE_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                  onChange={(v) => v && setGanttDateFormat(v)}
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
>>>>>>> Stashed changes
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
    body = (
      <>
        {header("Views", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-2 text-sm">
            <Table className="size-4" /> Table
            <span className="ml-auto text-xs text-muted-foreground">current</span>
          </div>
          <button
            disabled
            title="Coming soon"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground opacity-60"
          >
            <Plus className="size-4" /> Add view
            <span className="ml-auto text-xs">soon</span>
          </button>
          <p className="px-2 pt-2 text-xs text-muted-foreground">
            Board / Calendar / Gallery views coming later.
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

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l bg-popover text-popover-foreground shadow-xl">
        {body}
      </div>
    </>,
    document.body,
  );
}
