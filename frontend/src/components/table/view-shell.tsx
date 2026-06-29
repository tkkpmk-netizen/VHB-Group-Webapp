"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, ListFilter, SlidersHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { BoardView } from "@/components/table/board-view";
<<<<<<< Updated upstream
import { SearchBar } from "@/components/table/search-box";
=======
import { GanttView } from "@/components/table/gantt-view";
import type { GanttScale } from "@/components/table/gantt-scale";
import { Dropdown } from "@/components/ui/dropdown";
>>>>>>> Stashed changes
import { SettingsSidebar } from "@/components/table/settings-sidebar";
import { TableView } from "@/components/table/table-view";
import { matchedRowIds, searchHits } from "@/lib/search";
import {
  countRules,
  emptyGroup,
  type FilterGroup,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];
type View = components["schemas"]["ViewOut"];

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
<<<<<<< Updated upstream
=======
  ganttField?: string | null;
  ganttScale?: GanttScale | null;
  ganttLeftFields?: string[];
  ganttColWidths?: Record<string, number>;
  ganttDateFormat?: string;
  presets?: Preset[];
  activePreset?: string | null;
  limit?: number;
>>>>>>> Stashed changes
};

/** Per-view state every view renderer (Table/Board/…) reads from the shell. */
export type SharedViewProps = {
  filterRoot: FilterGroup;
  sorts: SortRule[];
  groupFieldId: string | null;
  hideEmpty: boolean;
  frozenUpTo: number;
  setFrozenUpTo: Dispatch<SetStateAction<number>>;
  calc: Record<string, string>;
  setCalc: Dispatch<SetStateAction<Record<string, string>>>;
  hidden: Set<string>;
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
}: {
  databaseId: string;
  view: View;
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
<<<<<<< Updated upstream

  // Search (database-level, not persisted) + settings panel.
  const [search, setSearch] = useState("");
  const [scopeFieldId, setScopeFieldId] = useState<string | null>(null);
  const [filterToMatches, setFilterToMatches] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
=======
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
  const [limit, setLimit] = useState<number>(cfg.limit ?? 10);
  const [presets, setPresets] = useState<Preset[]>(cfg.presets ?? []);
  const [activePreset, setActivePreset] = useState<string | null>(
    cfg.activePreset ?? null,
  );
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
  const [ganttToolbar, setGanttToolbar] = useState<HTMLDivElement | null>(null);
  const [quick, setQuick] = useState<{
    kind: "filter" | "sort" | "group";
    x: number;
    y: number;
  } | null>(null);
>>>>>>> Stashed changes

  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const rowsQ = useQuery<Row[]>({
    queryKey: ["rows", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
  });
  const fields = fieldsQ.data ?? [];
  const rows = rowsQ.data ?? [];

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
<<<<<<< Updated upstream
=======
      ganttField,
      ganttScale,
      ganttLeftFields,
      ganttColWidths,
      ganttDateFormat,
      presets,
      activePreset,
      limit,
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
    ganttField,
    ganttScale,
    ganttLeftFields,
    ganttColWidths,
    ganttDateFormat,
    presets,
    activePreset,
    limit,
>>>>>>> Stashed changes
  ]);

  // Search (over all rows; scope narrows to one field).
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const searchActive = search.trim().length > 0;
  const searchFields =
    scopeFieldId && byId[scopeFieldId] ? [byId[scopeFieldId]] : fields;
  const hits = searchActive ? searchHits(rows, searchFields, search) : [];
  const matchedIds = searchActive ? matchedRowIds(hits) : null;

  function jumpToRow(id: string) {
    setFlashId(id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }

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
    sorts,
    groupFieldId,
    hideEmpty,
    frozenUpTo,
    setFrozenUpTo,
    calc,
    setCalc,
    hidden,
    search,
    filterToMatches,
    matchedIds,
    flashId,
  };

<<<<<<< Updated upstream
  return (
    <div className="space-y-3">
      {/* Global toolbar: search + filter/sort chips + settings — on every view */}
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SearchBar
            fields={fields}
            hits={hits}
            scopeFieldId={scopeFieldId}
            setScopeFieldId={setScopeFieldId}
            query={search}
            setQuery={setSearch}
            filterToMatches={filterToMatches}
            setFilterToMatches={setFilterToMatches}
            onJump={jumpToRow}
=======
  // --- Quick View presets ---
  const baseline = activePreset ? presets.find((p) => p.id === activePreset) : null;
  const baseCfg = baseline
    ? {
        filter: baseline.filter,
        sorts: baseline.sorts,
        group: baseline.group,
        hideEmpty: baseline.hideEmpty,
      }
    : { filter: emptyGroup(), sorts: [], group: null, hideEmpty: false };
  const curCfg = {
    filter: filterRoot,
    sorts,
    group: groupFieldId,
    hideEmpty,
  };
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

  // Group axis is board-field on a Board (its columns), row-group elsewhere.
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
    <div className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
      {/* Toolbar: Quick View (left) · Filter/Sort/Group + search + Customize (right).
          Fixed height so opening the search bar doesn't shift the page down. */}
      <div className="flex h-10 shrink-0 items-center gap-1">
        <div className="w-44 shrink-0">
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
          <div ref={setGanttToolbar} className="flex flex-wrap items-center gap-3" />
        )}

        <div className="ml-auto flex items-center gap-1">
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
          {searchSlot}
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
                    ? Math.min(
                        quick.x,
                        window.innerWidth -
                          (quick.kind === "filter" ? 540 : 360) -
                          8,
                      )
                    : quick.x,
                width: quick.kind === "filter" ? 520 : quick.kind === "sort" ? 360 : 300,
              }}
            >
              {quick.kind === "filter" && (
                <FilterGroupEditor
                  group={filterRoot}
                  fields={fields}
                  onChange={setFilterRoot}
                />
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

      {/* Content + in-flow Customize panel (never covers the top bar) */}
      <div className="flex min-h-0 flex-1 items-stretch gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          ) : (
            <TableView databaseId={databaseId} {...shared} />
          )}
        </div>

        {settingsPage && (
          <SettingsSidebar
            databaseId={databaseId}
            viewId={view.id}
            viewType={view.type}
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
            initialPage={settingsPage}
            onClose={() => setSettingsPage(null)}
>>>>>>> Stashed changes
          />
        </div>
        {countRules(filterRoot) > 0 && (
          <button
            onClick={() => setSettingsPage("filter")}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-sm text-primary"
          >
            <ListFilter className="size-4" /> {countRules(filterRoot)}
          </button>
        )}
        {sorts.length > 0 && (
          <button
            onClick={() => setSettingsPage("sort")}
            className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-sm text-primary"
          >
            <ArrowUpDown className="size-4" /> {sorts.length}
          </button>
        )}
        <button
          onClick={() => setSettingsPage("main")}
          title="Settings"
          className="rounded-md px-2 py-1 text-sm hover:bg-muted"
        >
          <SlidersHorizontal className="size-4" />
        </button>
      </div>

      {view.type === "board" ? (
        <BoardView
          databaseId={databaseId}
          boardField={boardField}
          boardSubgroup={boardSubgroup}
          filterRoot={filterRoot}
          hidden={hidden}
          filterToMatches={filterToMatches}
          matchedIds={matchedIds}
        />
      ) : (
        <TableView databaseId={databaseId} {...shared} />
      )}

      {settingsPage && (
        <SettingsSidebar
          databaseId={databaseId}
          viewType={view.type}
          fields={fields}
          hidden={hidden}
          setHidden={setHidden}
          hasSubItems={hasSubItems}
          onToggleSubItems={toggleSubItems}
          boardField={boardField}
          setBoardField={setBoardField}
          boardSubgroup={boardSubgroup}
          setBoardSubgroup={setBoardSubgroup}
          filterRoot={filterRoot}
          setFilterRoot={setFilterRoot}
          sorts={sorts}
          setSorts={setSorts}
          groupFieldId={groupFieldId}
          setGroupFieldId={setGroupFieldId}
          hideEmpty={hideEmpty}
          setHideEmpty={setHideEmpty}
          initialPage={settingsPage}
          onClose={() => setSettingsPage(null)}
        />
      )}
    </div>
  );
}
