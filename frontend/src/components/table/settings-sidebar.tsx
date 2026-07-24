"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpAZ,
  ArrowUpDown,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  Group as GroupIcon,
  ListFilter,
  ListOrdered,
  GripVertical,
  Plus,
  Pin,
  Sigma,
  Star,
  Table,
  Trash2,
  WrapText,
  X,
  FaIcon,
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { DATE_FORMATS } from "@/components/table/gantt-view";
import { FieldConfig } from "@/components/table/field-config";
import {
  FilterGroupEditor,
  GroupEditor,
  SortEditor,
} from "@/components/table/view-tools";
import { countRules, operatorsFor, type FilterGroup, type SortRule } from "@/lib/view";
import type { ViewPresetT } from "@/components/table/view-shell";
import type { components } from "@/lib/api/schema";
import { iconForField } from "@/lib/icon-system";
import { calculationForField, calculationOptions } from "@/lib/calculations";

type Field = components["schemas"]["FieldOut"];
type Layout = components["schemas"]["LayoutOut"];
type Page =
  | "main"
  | "view"
  | "presets"
  | "visibility"
  | "filter"
  | "sort"
  | "group"
  | "fields";

const LIMIT_OPTIONS = [10, 20, 50, 100, 200].map((n) => ({
  value: String(n),
  label: `${n} entities`,
}));

export function SettingsSidebar({
  databaseId,
  viewType,
  views,
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
  ganttDateFormat,
  setGanttDateFormat,
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
  frozenUpTo,
  setFrozenUpTo,
  calc,
  setCalc,
  presets,
  activePresetId,
  onApplyPreset,
  onRenamePreset,
  onDeletePreset,
  initialPage = "main",
  onClose,
}: {
  databaseId: string;
  viewType: string;
  views: Layout[];
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
  ganttDateFormat: string;
  setGanttDateFormat: (f: string) => void;
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
  frozenUpTo: number;
  setFrozenUpTo: (value: number) => void;
  calc: Record<string, string>;
  setCalc: (value: Record<string, string>) => void;
  presets: ViewPresetT[];
  activePresetId: string | null;
  onApplyPreset: (id: string | null) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
  initialPage?: Page;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [page, setPage] = useState<Page>(initialPage);
  const [editFieldId, setEditFieldId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [viewDrag, setViewDrag] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const patchField = useMutation({
    mutationFn: ({ id, options }: { id: string; options: Record<string, unknown> }) =>
      apiFetch<Field>(`/fields/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ options }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });

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

  // --- Layout management ---
  const invalidateViews = () =>
    qc.invalidateQueries({ queryKey: ["layouts", databaseId] });
  const patchView = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch<Layout>(`/layouts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: invalidateViews,
  });
  const createView = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch<Layout>(`/databases/${databaseId}/layouts`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (v) => {
      invalidateViews();
      setActiveId(v.id);
    },
  });
  const deleteView = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/layouts/${id}`, { method: "DELETE" }),
    onSuccess: invalidateViews,
  });
  // Reorder = PATCH each view's `order` to its new index (no bulk endpoint).
  function reorderViews(ids: string[]) {
    ids.forEach((id, i) => patchView.mutate({ id, body: { order: i } }));
  }
  function moveView(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = views.map((v) => v.id).filter((i) => i !== fromId);
    ids.splice(ids.indexOf(toId), 0, fromId);
    reorderViews(ids);
  }
  function setDefaultView(id: string) {
    reorderViews([id, ...views.map((v) => v.id).filter((i) => i !== id)]);
  }
  function duplicateView(v: Layout) {
    createView.mutate({ name: `${v.name} copy`, type: v.type, config: v.config });
  }

  const shownCount = fields.filter((f) => !hidden.has(f.id)).length;
  const groupField = fields.find((f) => f.id === groupFieldId);
  const editField = fields.find((f) => f.id === editFieldId);

  const header = (title: React.ReactNode, back?: () => void) => (
    <div className="flex h-10 items-center gap-2 border-b px-3">
      {back && (
        <button onClick={back} className="rounded p-1 hover:bg-muted">
          <ChevronLeft className="size-4" />
        </button>
      )}
      <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold">{title}</h2>
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
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
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
    const fieldIndex = fields.findIndex((field) => field.id === editField.id);
    const isFrozen = fieldIndex >= 0 && fieldIndex <= frozenUpTo;
    const isGrouped = groupFieldId === editField.id;
    const sortDirection = sorts.find((sort) => sort.fieldId === editField.id)?.dir;
    const wrapped = (editField.options as { wrap?: boolean }).wrap === true;
    const setSort = (dir: "asc" | "desc") =>
      setSorts([
        { fieldId: editField.id, dir },
        ...sorts.filter((sort) => sort.fieldId !== editField.id),
      ]);
    const addFilter = () =>
      setFilterRoot({
        ...filterRoot,
        rules: [
          ...filterRoot.rules,
          {
            fieldId: editField.id,
            op: operatorsFor(editField.type)[0]?.value ?? "is",
            value: "",
          },
        ],
      });
    const insert = (side: "left" | "right") => {
      window.dispatchEvent(
        new CustomEvent("vhb:insert-field", {
          detail: { targetId: editField.id, side },
        }),
      );
      onClose();
    };
    body = (
      <>
        {header(
          <>
            <FaIcon
              name={iconForField(editField)}
              className="size-3.5 shrink-0"
              style={{ color: editField.icon_color || "var(--icon-field-text)" }}
            />
            <span className="truncate">Edit Field · {editField.name}</span>
          </>,
          () => setEditFieldId(null),
        )}
        <div className="flex-1 overflow-y-auto p-3">
          <section className="mb-3 rounded-lg border bg-muted/20 p-2">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field actions
            </p>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={() => setSort("asc")} className={`field-action ${sortDirection === "asc" ? "field-action-active" : ""}`}><ArrowUpAZ className="size-3.5" /> Sort ascending</button>
              <button onClick={() => setSort("desc")} className={`field-action ${sortDirection === "desc" ? "field-action-active" : ""}`}><ArrowDownAZ className="size-3.5" /> Sort descending</button>
              <button onClick={() => setGroupFieldId(isGrouped ? null : editField.id)} className={`field-action ${isGrouped ? "field-action-active" : ""}`}><GroupIcon className="size-3.5" /> {isGrouped ? "Ungroup" : "Group"}</button>
              <button onClick={addFilter} className="field-action"><ListFilter className="size-3.5" /> Filter</button>
              <button onClick={() => patchField.mutate({ id: editField.id, options: { ...editField.options, wrap: !wrapped } })} className={`field-action ${wrapped ? "field-action-active" : ""}`}><WrapText className="size-3.5" /> Wrap text</button>
              <button onClick={() => setFrozenUpTo(isFrozen ? fieldIndex - 1 : fieldIndex)} className={`field-action ${isFrozen ? "field-action-active" : ""}`}><Pin className="size-3.5" /> {isFrozen ? "Unfreeze" : "Freeze"}</button>
              <button onClick={() => insert("left")} className="field-action"><ArrowLeftToLine className="size-3.5" /> Insert left</button>
              <button onClick={() => insert("right")} className="field-action"><ArrowRightToLine className="size-3.5" /> Insert right</button>
            </div>
            <label className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Sigma className="size-3.5" /> Calculate
              <span className="ml-auto w-32">
                <Dropdown
                  value={calculationForField(
                    editField.type,
                    calc[editField.id],
                  )}
                  placeholder="None"
                  options={calculationOptions(editField.type)}
                  onChange={(value) =>
                    setCalc({ ...calc, [editField.id]: value ?? "" })
                  }
                />
              </span>
            </label>
          </section>
          <FieldConfig
            key={`${editField.id}:${editField.type}`}
            field={editField}
            databaseId={databaseId}
          />
          <button
            onClick={() => del.mutate(editField.id)}
            className="mt-3 flex w-full items-center gap-2 border-t pt-3 text-xs text-destructive hover:opacity-80"
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
          {viewType === "gantt" && (
            <div className="mb-1 space-y-2 rounded-lg border bg-muted/30 p-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Timeline
              </p>
              <label className="block text-xs text-muted-foreground">
                Date format
                <Dropdown
                  value={ganttDateFormat}
                  options={DATE_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                  onChange={(v) => v && setGanttDateFormat(v)}
                />
              </label>
            </div>
          )}
          {row(<Table className="size-4" />, "Layouts", () => setPage("view"), String(views.length))}
          {row(<Bookmark className="size-4" />, "View presets", () => setPage("presets"), presets.length ? String(presets.length) : undefined)}
          {row(<Eye className="size-4" />, "Field visibility", () => setPage("visibility"), String(shownCount))}
          {row(<ListFilter className="size-4" />, "Filter", () => setPage("filter"), countRules(filterRoot) ? String(countRules(filterRoot)) : undefined)}
          {row(<ArrowUpDown className="size-4" />, "Sort", () => setPage("sort"), sorts.length ? String(sorts.length) : undefined)}
          {row(<GroupIcon className="size-4" />, "Group", () => setPage("group"), groupField?.name)}
          {row(<ListOrdered className="size-4" />, "Edit Field", () => setPage("fields"))}
          <div className="my-1 border-t" />
          <label className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs">
            <span className="flex-1 text-muted-foreground">Entities per page</span>
            <div className="w-28">
              <Dropdown
                value={String(limit)}
                allowClear={false}
                options={LIMIT_OPTIONS}
                onChange={(v) => v && setLimit(Number(v))}
              />
            </div>
          </label>
          <label className="flex h-8 items-center gap-2 rounded-md px-2 text-xs">
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
        {header("Layout", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <p className="flex items-center gap-1 px-1 pb-1 text-xs text-muted-foreground">
            <span>Drag to reorder ·</span>
            <Star className="size-3" />
            <span>set default · double-click to rename</span>
          </p>
          {views.map((v, i) => {
            const isActive = v.id === activeId;
            const isDefault = i === 0;
            return (
              <div
                key={v.id}
                draggable={renameId !== v.id}
                onDragStart={() => setViewDrag(v.id)}
                onDragOver={(e) => viewDrag && e.preventDefault()}
                onDrop={() => {
                  if (viewDrag) moveView(viewDrag, v.id);
                  setViewDrag(null);
                }}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm ${
                  isActive ? "bg-muted" : "hover:bg-muted"
                }`}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
                {renameId === v.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => {
                      if (renameText.trim())
                        patchView.mutate({ id: v.id, body: { name: renameText.trim() } });
                      setRenameId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenameId(null);
                    }}
                    className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <button
                    onClick={() => {
                      setActiveId(v.id);
                      onClose();
                    }}
                    onDoubleClick={() => {
                      setRenameId(v.id);
                      setRenameText(v.name);
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {v.name}
                    <span className="ml-1 text-xs text-muted-foreground">{v.type}</span>
                  </button>
                )}
                <button
                  onClick={() => setDefaultView(v.id)}
                  title="Set as default"
                  className={isDefault ? "text-primary" : "text-muted-foreground/50 hover:text-foreground"}
                >
                  <Star className={`size-3.5 ${isDefault ? "fill-current" : ""}`} />
                </button>
                <button
                  onClick={() => duplicateView(v)}
                  title="Duplicate"
                  className="text-muted-foreground/60 hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (views.length <= 1) return;
                    if (isActive) setActiveId(views.find((x) => x.id !== v.id)!.id);
                    deleteView.mutate(v.id);
                  }}
                  disabled={views.length <= 1}
                  title="Delete"
                  className="text-muted-foreground/60 hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
          <div className="mt-1 border-t pt-2">
            <p className="px-1 pb-1 text-xs font-semibold uppercase text-muted-foreground">
              Add layout
            </p>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["table", "Table"],
                  ["board", "Board"],
                  ["list", "List"],
                  ["calendar", "Calendar"],
                  ["gallery", "Gallery"],
                  ["gantt", "Timeline"],
                ] as const
              ).map(([t, label]) => (
                <button
                  key={t}
                  onClick={() => createView.mutate({ name: label, type: t, config: {} })}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-muted"
                >
                  <Plus className="size-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  } else if (page === "presets") {
    body = (
      <>
        {header("View presets", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {presets.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No presets yet. Save the current filter/sort/group with the “Save preset”
              button in the toolbar.
            </p>
          )}
          {presets.map((p) => {
            const isActive = p.id === activePresetId;
            return (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm ${
                  isActive ? "bg-muted" : "hover:bg-muted"
                }`}
              >
                {renameId === p.id ? (
                  <input
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onBlur={() => {
                      const name = renameText.trim();
                      if (name) onRenamePreset(p.id, name);
                      setRenameId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenameId(null);
                    }}
                    className="min-w-0 flex-1 rounded border bg-background px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-ring"
                  />
                ) : (
                  <button
                    onClick={() => onApplyPreset(p.id)}
                    onDoubleClick={() => {
                      setRenameId(p.id);
                      setRenameText(p.name);
                    }}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {p.name}
                  </button>
                )}
                <button
                  onClick={() => onApplyPreset(p.id)}
                  title="Set as default"
                  className={isActive ? "text-primary" : "text-muted-foreground/50 hover:text-foreground"}
                >
                  <Star className={`size-3.5 ${isActive ? "fill-current" : ""}`} />
                </button>
                <button
                  onClick={() => {
                    if (isActive) onApplyPreset(null);
                    onDeletePreset(p.id);
                  }}
                  title="Delete"
                  className="text-muted-foreground/60 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </>
    );
  } else if (page === "visibility") {
    const filtered = fields.filter((f) =>
      f.name.toLowerCase().includes(search.toLowerCase()),
    );
    body = (
      <>
        {header("Field visibility", () => setPage("main"))}
        <div className="flex-1 overflow-y-auto p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for a property…"
            className="mb-3 h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Fields
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
                  <FaIcon
                    name={iconForField(f)}
                    className="size-3.5 shrink-0"
                    style={{ color: f.icon_color || "var(--icon-field-text)" }}
                  />
                  <span className="flex-1 text-xs">
                    {f.name}
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
    // Fields list
    body = (
      <>
        {header("Edit Field", () => setPage("main"))}
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {fields.map((f) => (
            <button
              key={f.id}
              onClick={() => setEditFieldId(f.id)}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
            >
              <FaIcon
                name={iconForField(f)}
                className="size-3.5 shrink-0"
                style={{ color: f.icon_color || "var(--icon-field-text)" }}
              />
              <span className="flex-1 text-left">
                {f.name}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="absolute inset-0 z-40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 z-50 flex w-80 max-w-[min(100%,24rem)] flex-col border-l bg-popover text-popover-foreground shadow-xl">
        {body}
      </div>
    </>
  );
}
