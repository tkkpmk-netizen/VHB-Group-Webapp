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
} from "@/components/ui/fa-icon";
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
import { EntityDetailDialog } from "@/components/table/entity-detail-dialog";
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
type Layout = components["schemas"]["LayoutOut"];
export type ViewPresetT = components["schemas"]["ViewPresetOut"];
type DataSourceT = components["schemas"]["DataSourceOut"];
type Entity = components["schemas"]["EntityOut"];

/** Persisted per-layout config (everything except ephemeral UI like collapse). */
export type LayoutConfig = {
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
  dataSourceId?: string | null;
};

/** Per-layout state every layout renderer (Table/Board/…) reads from the shell. */
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
  dataSourceId: string | null;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
  openEntity: (entity: Entity) => void;
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
 * Shared chrome for every layout of a database: toolbar, scoped settings panel,
 * and per-layout config state, rendered once regardless of layout type.
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
  view: Layout;
  views: Layout[];
  activeId: string;
  setActiveId: (id: string) => void;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
}) {
  const qc = useQueryClient();
  const cfg = (view.config ?? {}) as LayoutConfig;

  // Per-layout config (hydrated from view.config; remounts on layout switch via key).
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
  const [dataSourceId, setDataSourceId] = useState<string | null>(cfg.dataSourceId ?? null);

  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
  const [activeEntity, setActiveEntity] = useState<Entity | null>(null);
  const [ganttToolbar, setGanttToolbar] = useState<HTMLDivElement | null>(null);
  const [calendarToolbar, setCalendarToolbar] = useState<HTMLDivElement | null>(null);
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
  const dataSourcesQ = useQuery<DataSourceT[]>({
    queryKey: ["data-sources", databaseId],
    queryFn: () => apiFetch<DataSourceT[]>(`/databases/${databaseId}/data-sources`),
  });
  const dataSources = dataSourcesQ.data ?? [];

  // Persist config (debounced). No layouts-query invalidation → no save→refetch loop.
  const saveView = useMutation({
    mutationFn: (config: LayoutConfig) =>
      apiFetch<Layout>(`/layouts/${view.id}`, {
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
    const config: LayoutConfig = {
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
      dataSourceId,
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
    dataSourceId,
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
    dataSourceId,
    search,
    filterToMatches,
    matchedIds,
    flashId,
    openEntity: setActiveEntity,
  };

  // --- View presets (named, server-persisted snapshots of filter/sort/group) ---
  const presetsQ = useQuery<ViewPresetT[]>({
    queryKey: ["view-presets", view.id],
    queryFn: () => apiFetch<ViewPresetT[]>(`/layouts/${view.id}/view-presets`),
  });
  const presets = presetsQ.data ?? [];
  const activePresetId = view.active_view_preset_id;
  const invalidatePresets = () => qc.invalidateQueries({ queryKey: ["view-presets", view.id] });
  const invalidateViews = () => qc.invalidateQueries({ queryKey: ["layouts", databaseId] });

  const curCfg = { filter: filterRoot, sorts, group_field_id: groupFieldId, hide_empty: hideEmpty };
  const baseline = activePresetId ? presets.find((p) => p.id === activePresetId) : null;
  const baseCfg = baseline
    ? {
        filter: baseline.filter,
        sorts: baseline.sorts,
        group_field_id: baseline.group_field_id,
        hide_empty: baseline.hide_empty,
      }
    : { filter: emptyGroup(), sorts: [], group_field_id: null, hide_empty: false };
  const dirty = JSON.stringify(curCfg) !== JSON.stringify(baseCfg);

  const applyPresetMut = useMutation({
    mutationFn: (id: string | null) =>
      apiFetch<Layout>(`/layouts/${view.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active_view_preset_id: id }),
      }),
    onSuccess: invalidateViews,
  });
  function applyPreset(id: string | null) {
    const p = id ? presets.find((x) => x.id === id) : null;
    setFilterRoot((p?.filter as FilterGroup) ?? emptyGroup());
    setSorts((p?.sorts as SortRule[]) ?? []);
    setGroupFieldId(p?.group_field_id ?? null);
    setHideEmpty(p?.hide_empty ?? false);
    applyPresetMut.mutate(id);
  }

  const createPresetMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch<ViewPresetT>(`/layouts/${view.id}/view-presets`, {
        method: "POST",
        body: JSON.stringify({ name, ...curCfg }),
      }),
    onSuccess: (created) => {
      invalidatePresets();
      applyPresetMut.mutate(created.id);
      setNaming(false);
    },
  });
  function createPreset() {
    const name = presetName.trim();
    if (!name) return;
    createPresetMut.mutate(name);
  }

  const updatePresetMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ViewPresetT>(`/view-presets/${id}`, {
        method: "PATCH",
        body: JSON.stringify(curCfg),
      }),
    onSuccess: invalidatePresets,
  });
  function savePreset() {
    if (activePresetId) {
      updatePresetMut.mutate(activePresetId);
    } else {
      setNaming(true);
      setPresetName("");
    }
  }

  const renamePresetMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<ViewPresetT>(`/view-presets/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: invalidatePresets,
  });
  const deletePresetMut = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/view-presets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidatePresets();
      invalidateViews();
    },
  });

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
    `flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] font-medium transition-colors ${
      active
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-transparent bg-background text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
    }`;

  return (
    <div className="relative flex h-full min-h-0 flex-col px-[18px] pb-2 pt-0">
      {/* Toolbar: View preset (left) · gantt controls · Filter/Sort/Group +
          Customize (right). Search lives beside the layout tabs. */}
      <div className="-mx-[18px] my-1 flex h-7 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden px-[18px]">
        <div className="w-32 shrink-0 sm:w-36">
          <Dropdown
            value={activePresetId ?? "__default__"}
            placeholder="Default View"
            options={[
              { value: "__default__", label: "Default View" },
              ...presets.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(value) => applyPreset(value === "__default__" ? null : value)}
            allowClear={false}
            compact
          />
        </div>
        {dataSources.length > 1 && (
          <div className="w-28 shrink-0 sm:w-32">
            <Dropdown
              value={dataSourceId}
              placeholder="All sources"
              options={dataSources.map((d) => ({ value: d.id, label: d.name }))}
              onChange={setDataSourceId}
              compact
            />
          </div>
        )}
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
                className="h-6 w-28 rounded border bg-background px-1.5 text-[11px] outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={createPreset}
                className="h-6 rounded bg-primary px-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
              >
                Save
              </button>
            </span>
          ) : (
            <button
              onClick={savePreset}
              title="Save current filters as a preset"
              className="flex h-6 items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 text-[11px] font-medium text-primary hover:bg-primary/15"
            >
              <Save className="size-3" /> {activePresetId ? "Save" : "Save preset"}
            </button>
          ))}

        {view.type === "gantt" && (
          <div
            ref={setGanttToolbar}
            className="flex shrink-0 items-center gap-1"
          />
        )}
        {view.type === "calendar" && (
          <div
            ref={setCalendarToolbar}
            className="flex shrink-0 items-center gap-1"
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button onClick={openQuick("filter")} className={quickCls(nRules > 0)}>
            <ListFilter className="size-3.5" />
            Filter{nRules > 0 ? ` · ${nRules}` : ""}
          </button>
          <button onClick={openQuick("sort")} className={quickCls(sorts.length > 0)}>
            <ArrowUpDown className="size-3.5" />
            Sort{sorts.length > 0 ? ` · ${sorts.length}` : ""}
          </button>
          <button onClick={openQuick("group")} className={quickCls(!!grpId)}>
            <GroupIcon className="size-3.5" />
            {groupName ? `Group: ${groupName}` : "Group"}
          </button>
          {dirty && (
            <button
              onClick={() => applyPreset(activePresetId)}
              title="Reset to preset"
              className="flex h-6 items-center gap-1 rounded border border-transparent bg-background px-1.5 text-[11px] text-muted-foreground hover:border-border hover:bg-muted"
            >
              <RotateCcw className="size-3" /> Reset
            </button>
          )}
          <button
            onClick={() => setSettingsPage((p) => (p ? null : "main"))}
            title="Customize"
            className={`flex h-6 items-center gap-1 rounded border px-1.5 text-[11px] font-medium ${
              settingsPage ? "border-primary/30 bg-primary/10 text-primary" : "border-transparent bg-background text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
            }`}
          >
            <SlidersHorizontal className="size-3" /> Customize
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
            ? "min-h-0 flex-1 overflow-hidden"
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
          dataSourceId={dataSourceId}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
          openEntity={setActiveEntity}
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
          dataSourceId={dataSourceId}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
          openEntity={setActiveEntity}
        />
      ) : view.type === "calendar" ? (
        <CalendarView
          databaseId={databaseId}
          calendarField={calendarField}
          setCalendarField={setCalendarField}
          calendarMode={calendarMode}
          setCalendarMode={setCalendarMode}
          toolbarSlot={calendarToolbar}
          filterRoot={filterRoot}
          dataSourceId={dataSourceId}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
          openEntity={setActiveEntity}
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
          frozenUpTo={frozenUpTo}
          setFrozenUpTo={setFrozenUpTo}
          calc={calc}
          setCalc={setCalc}
          presets={presets}
          activePresetId={activePresetId}
          onApplyPreset={applyPreset}
          onRenamePreset={(id, name) => renamePresetMut.mutate({ id, name })}
          onDeletePreset={(id) => deletePresetMut.mutate(id)}
          initialPage={settingsPage}
          onClose={() => setSettingsPage(null)}
        />
      )}
      {activeEntity && (
        <EntityDetailDialog
          databaseId={databaseId}
          entity={activeEntity}
          fields={fields}
          onClose={() => setActiveEntity(null)}
        />
      )}
    </div>
  );
}
