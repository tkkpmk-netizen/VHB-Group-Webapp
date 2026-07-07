"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown,
  Group as GroupIcon,
  ListFilter,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { BoardView } from "@/components/table/board-view";
import { CalendarView } from "@/components/table/calendar-view";
import { GalleryView } from "@/components/table/gallery-view";
import { GanttView } from "@/components/table/gantt-view";
import { ListView } from "@/components/table/list-view";
import type { GanttScale } from "@/components/table/gantt-scale";
import { Dropdown } from "@/components/ui/dropdown";
import { SettingsSidebar } from "@/components/table/settings-sidebar";
import { TableView } from "@/components/table/table-view";
import {
  FilterGroupEditor,
  GroupEditor,
  SortEditor,
} from "@/components/table/view-tools";
import {
  countRules,
  emptyGroup,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type View = components["schemas"]["ViewOut"];

/** A saved Quick View preset = a named snapshot of filter/sort/group. */
export type Preset = {
  id: string;
  name: string;
  filter: FilterGroup;
  sorts: SortRule[];
  group: string | null;
  hideEmpty: boolean;
};

/** Persisted per-view config (everything except ephemeral UI like collapse). */
export type ViewConfig = {
  filter?: FilterGroup;
  sorts?: SortRule[];
  group?: string | null;
  hideEmpty?: boolean;
  frozenUpTo?: number;
  calc?: Record<string, string>;
  hidden?: string[];
  boardField?: string | null;
  boardSubgroup?: string | null;
  ganttField?: string | null;
  ganttScale?: GanttScale | null;
  ganttLeftFields?: string[];
  ganttColWidths?: Record<string, number>;
  ganttDateFormat?: string;
  calendarField?: string | null;
  calendarMode?: string;
  limit?: number;
  presets?: Preset[];
  activePreset?: string | null;
};

/** Per-view state every view renderer (Table/Board/…) reads from the shell. */
export type SharedViewProps = {
  filterRoot: FilterGroup;
  setFilterRoot: (g: FilterGroup) => void;
  sorts: SortRule[];
  setSorts: (s: SortRule[]) => void;
  groupFieldId: string | null;
  setGroupFieldId: (id: string | null) => void;
  hideEmpty: boolean;
  frozenUpTo: number;
  setFrozenUpTo: Dispatch<SetStateAction<number>>;
  calc: Record<string, string>;
  setCalc: Dispatch<SetStateAction<Record<string, string>>>;
  hidden: Set<string>;
  limit: number;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
};

type SettingsPage =
  | "main"
  | "view"
  | "visibility"
  | "filter"
  | "sort"
  | "group"
  | "fields"
  | null;

/**
 * Shared chrome for every view of a database: the global Search bar + Settings
 * sidebar + per-view config state, rendered once regardless of view type.
 */
export function ViewShell({
  databaseId,
  view,
  views,
  activeId,
  setActiveId,
  search,
  filterToMatches,
  matchedIds,
  flashId,
}: {
  databaseId: string;
  view: View;
  views: View[];
  activeId: string;
  setActiveId: (id: string) => void;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
}) {
  const qc = useQueryClient();
  const cfg = (view.config ?? {}) as ViewConfig;

  // Per-view config (hydrated from view.config; remounts on view switch via key).
  const [filterRoot, setFilterRoot] = useState<FilterGroup>(cfg.filter ?? emptyGroup());
  const [sorts, setSorts] = useState<SortRule[]>(cfg.sorts ?? []);
  const [groupFieldId, setGroupFieldId] = useState<string | null>(cfg.group ?? null);
  const [hideEmpty, setHideEmpty] = useState(cfg.hideEmpty ?? false);
  const [frozenUpTo, setFrozenUpTo] = useState(cfg.frozenUpTo ?? -1);
  const [calc, setCalc] = useState<Record<string, string>>(cfg.calc ?? {});
  const [hidden, setHidden] = useState<Set<string>>(new Set(cfg.hidden ?? []));
  const [boardField, setBoardField] = useState<string | null>(cfg.boardField ?? null);
  const [boardSubgroup, setBoardSubgroup] = useState<string | null>(
    cfg.boardSubgroup ?? null,
  );
  const [ganttField, setGanttField] = useState<string | null>(cfg.ganttField ?? null);
  const [ganttScale, setGanttScale] = useState<GanttScale | null>(cfg.ganttScale ?? null);
  const [ganttLeftFields, setGanttLeftFields] = useState<string[]>(
    cfg.ganttLeftFields ?? [],
  );
  const [ganttColWidths, setGanttColWidths] = useState<Record<string, number>>(
    cfg.ganttColWidths ?? {},
  );
  const [ganttDateFormat, setGanttDateFormat] = useState<string>(
    cfg.ganttDateFormat ?? "locale",
  );
  const [calendarField, setCalendarField] = useState<string | null>(
    cfg.calendarField ?? null,
  );
  const [calendarMode, setCalendarMode] = useState<string>(cfg.calendarMode ?? "month");
  const [limit, setLimit] = useState<number>(cfg.limit ?? 10);

  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
  const [ganttToolbar, setGanttToolbar] = useState<HTMLDivElement | null>(null);
  const [presets, setPresets] = useState<Preset[]>(cfg.presets ?? []);
  const [activePreset, setActivePreset] = useState<string | null>(
    cfg.activePreset ?? null,
  );
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [quick, setQuick] = useState<{
    kind: "filter" | "sort" | "group";
    x: number;
    y: number;
  } | null>(null);

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const fields = fieldsQ.data ?? [];

  // Persist config (debounced). No views-query invalidation → no save→refetch loop.
  const saveView = useMutation({
    mutationFn: (config: ViewConfig) =>
      apiFetch<View>(`/views/${view.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config }),
      }),
  });
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    const config: ViewConfig = {
      filter: filterRoot,
      sorts,
      group: groupFieldId,
      hideEmpty,
      frozenUpTo,
      calc,
      hidden: [...hidden],
      boardField,
      boardSubgroup,
      ganttField,
      ganttScale,
      ganttLeftFields,
      ganttColWidths,
      ganttDateFormat,
      calendarField,
      calendarMode,
      limit,
      presets,
      activePreset,
    };
    const t = setTimeout(() => saveView.mutate(config), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filterRoot,
    sorts,
    groupFieldId,
    hideEmpty,
    frozenUpTo,
    calc,
    hidden,
    boardField,
    boardSubgroup,
    ganttField,
    ganttScale,
    ganttLeftFields,
    ganttColWidths,
    ganttDateFormat,
    calendarField,
    calendarMode,
    limit,
    presets,
    activePreset,
  ]);

  // Sub-items toggle (creates/deletes the two self-relation fields).
  const hasSubItems = fields.some(
    (f) => (f.options as { sub_item?: boolean })?.sub_item,
  );
  const addSubItems = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/databases/${databaseId}/sub-items`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });
  function toggleSubItems(enable: boolean) {
    if (enable) {
      addSubItems.mutate();
    } else {
      const ids = fields
        .filter((f) => (f.options as { sub_item?: boolean })?.sub_item)
        .map((f) => f.id);
      Promise.all(
        ids.map((id) => apiFetch<void>(`/fields/${id}`, { method: "DELETE" })),
      ).then(() => qc.invalidateQueries({ queryKey: ["fields", databaseId] }));
    }
  }

  const shared: SharedViewProps = {
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
    search,
    filterToMatches,
    matchedIds,
    flashId,
  };

  // --- Quick View presets (named snapshots of filter/sort/group) ---
  const baseline = activePreset ? presets.find((p) => p.id === activePreset) : null;
  const baseCfg = baseline
    ? {
        filter: baseline.filter,
        sorts: baseline.sorts,
        group: baseline.group,
        hideEmpty: baseline.hideEmpty,
      }
    : { filter: emptyGroup(), sorts: [], group: null, hideEmpty: false };
  const curCfg = { filter: filterRoot, sorts, group: groupFieldId, hideEmpty };
  const dirty = JSON.stringify(curCfg) !== JSON.stringify(baseCfg);

  function applyPreset(id: string | null) {
    setActivePreset(id);
    const p = id ? presets.find((x) => x.id === id) : null;
    setFilterRoot(p?.filter ?? emptyGroup());
    setSorts(p?.sorts ?? []);
    setGroupFieldId(p?.group ?? null);
    setHideEmpty(p?.hideEmpty ?? false);
  }
  function savePreset() {
    if (activePreset) {
      setPresets(presets.map((p) => (p.id === activePreset ? { ...p, ...curCfg } : p)));
    } else {
      setNaming(true);
      setPresetName("");
    }
  }
  function createPreset() {
    const name = presetName.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    setPresets([...presets, { id, name, ...curCfg }]);
    setActivePreset(id);
    setNaming(false);
  }

  // Group axis is the board-field on a Board (its columns), row-group elsewhere.
  const isBoard = view.type === "board";
  const grpId = isBoard ? boardField : groupFieldId;
  const setGrpId = isBoard ? setBoardField : setGroupFieldId;
  const groupName = fields.find((f) => f.id === grpId)?.name;
  const nRules = countRules(filterRoot);
  const openQuick = (kind: "filter" | "sort" | "group") => (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setQuick((q) => (q?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 4 }));
  };
  const quickCls = (active: boolean) =>
    `flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
      active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar: Quick View preset (left) · gantt controls · search +
          Filter/Sort/Group + Customize (right). */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="w-40 shrink-0 sm:w-44">
          <Dropdown
            value={activePreset}
            placeholder="Default view"
            options={presets.map((p) => ({ value: p.id, label: p.name }))}
            onChange={applyPreset}
          />
        </div>
        {dirty &&
          (naming ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createPreset();
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="Preset name…"
                className="w-32 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={createPreset}
                className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Save
              </button>
            </span>
          ) : (
            <button
              onClick={savePreset}
              title="Save current filters as a preset"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary hover:bg-primary/10"
            >
              <Save className="size-4" /> {activePreset ? "Save" : "Save view"}
            </button>
          ))}

        {view.type === "gantt" && (
          <div
            ref={setGanttToolbar}
            className="order-last flex w-full flex-wrap items-center gap-2 xl:order-none xl:w-auto"
          />
        )}

        <div className="flex w-full shrink-0 flex-wrap items-center gap-1 xl:ml-auto xl:w-auto xl:justify-end">
          <button onClick={openQuick("filter")} className={quickCls(nRules > 0)}>
            <ListFilter className="size-4" />
            Filter{nRules > 0 ? ` · ${nRules}` : ""}
          </button>
          <button onClick={openQuick("sort")} className={quickCls(sorts.length > 0)}>
            <ArrowUpDown className="size-4" />
            Sort{sorts.length > 0 ? ` · ${sorts.length}` : ""}
          </button>
          <button onClick={openQuick("group")} className={quickCls(!!grpId)}>
            <GroupIcon className="size-4" />
            {groupName ? `Group: ${groupName}` : "Group"}
          </button>
          {dirty && (
            <button
              onClick={() => applyPreset(activePreset)}
              title="Reset to saved view"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="size-4" /> Reset
            </button>
          )}
          <button
            onClick={() => setSettingsPage((p) => (p ? null : "main"))}
            title="Customize"
            className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
              settingsPage ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <SlidersHorizontal className="size-4" /> Customize
          </button>
        </div>
      </div>

      {quick &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setQuick(null)} />
            <div
              className="fixed z-50 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
              style={{
                top: quick.y,
                left:
                  typeof window !== "undefined"
                    ? Math.max(
                        8,
                        Math.min(
                          quick.x,
                          window.innerWidth -
                            Math.min(
                              quick.kind === "filter"
                                ? 520
                                : quick.kind === "sort"
                                  ? 360
                                  : 300,
                              window.innerWidth - 16,
                            ) -
                            8,
                        ),
                      )
                    : quick.x,
                width:
                  typeof window !== "undefined"
                    ? Math.min(
                        quick.kind === "filter"
                          ? 520
                          : quick.kind === "sort"
                            ? 360
                            : 300,
                        window.innerWidth - 16,
                      )
                    : quick.kind === "filter"
                      ? 520
                      : quick.kind === "sort"
                        ? 360
                        : 300,
                maxHeight: "calc(100vh - 16px)",
                overflowY: "auto",
              }}
            >
              {quick.kind === "filter" && (
                <FilterGroupEditor group={filterRoot} fields={fields} onChange={setFilterRoot} />
              )}
              {quick.kind === "sort" && (
                <SortEditor fields={fields} sorts={sorts} setSorts={setSorts} />
              )}
              {quick.kind === "group" && (
                <GroupEditor
                  fields={fields}
                  groupFieldId={grpId}
                  setGroupFieldId={setGrpId}
                  hideEmpty={hideEmpty}
                  setHideEmpty={setHideEmpty}
                />
              )}
            </div>
          </>,
          document.body,
        )}

      <div
        className={
          view.type === "board"
            ? "min-h-0 flex-1 overflow-auto"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
      {view.type === "board" ? (
        <BoardView
          databaseId={databaseId}
          boardField={boardField}
          boardSubgroup={boardSubgroup}
          filterRoot={filterRoot}
          sorts={sorts}
          limit={limit}
          hidden={hidden}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
        />
      ) : view.type === "gantt" ? (
        <GanttView
          databaseId={databaseId}
          ganttField={ganttField}
          setGanttField={setGanttField}
          ganttScale={ganttScale}
          setGanttScale={setGanttScale}
          ganttLeftFields={ganttLeftFields}
          setGanttLeftFields={setGanttLeftFields}
          ganttColWidths={ganttColWidths}
          setGanttColWidths={setGanttColWidths}
          ganttDateFormat={ganttDateFormat}
          toolbarSlot={ganttToolbar}
          filterRoot={filterRoot}
          sorts={sorts}
          limit={limit}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
        />
      ) : view.type === "calendar" ? (
        <CalendarView
          databaseId={databaseId}
          calendarField={calendarField}
          setCalendarField={setCalendarField}
          calendarMode={calendarMode}
          setCalendarMode={setCalendarMode}
          filterRoot={filterRoot}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
        />
      ) : view.type === "list" ? (
        <ListView databaseId={databaseId} {...shared} />
      ) : view.type === "gallery" ? (
        <GalleryView databaseId={databaseId} {...shared} />
      ) : (
        <TableView databaseId={databaseId} {...shared} />
      )}
      </div>

      {settingsPage && (
        <SettingsSidebar
          databaseId={databaseId}
          viewType={view.type}
          views={views}
          activeId={activeId}
          setActiveId={setActiveId}
          fields={fields}
          hidden={hidden}
          setHidden={setHidden}
          hasSubItems={hasSubItems}
          onToggleSubItems={toggleSubItems}
          boardField={boardField}
          setBoardField={setBoardField}
          boardSubgroup={boardSubgroup}
          setBoardSubgroup={setBoardSubgroup}
          ganttDateFormat={ganttDateFormat}
          setGanttDateFormat={setGanttDateFormat}
          limit={limit}
          setLimit={setLimit}
          filterRoot={filterRoot}
          setFilterRoot={setFilterRoot}
          sorts={sorts}
          setSorts={setSorts}
          groupFieldId={groupFieldId}
          setGroupFieldId={setGroupFieldId}
          hideEmpty={hideEmpty}
          setHideEmpty={setHideEmpty}
          presets={presets}
          setPresets={setPresets}
          activePreset={activePreset}
          setActivePreset={setActivePreset}
          initialPage={settingsPage}
          onClose={() => setSettingsPage(null)}
        />
      )}
    </div>
  );
}
