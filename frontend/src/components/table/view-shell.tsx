"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
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
type Preset = {
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
  presets?: Preset[];
  activePreset?: string | null;
  limit?: number;
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
  setHidden: (s: Set<string>) => void;
  limit: number;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
};

type SettingsPage = "main" | "view" | "visibility" | "fields" | null;

/**
 * Per-view chrome: the quick Filter/Sort/Group toolbar + Customize sidebar +
 * the per-view config state. Search lives one level up (the top bar) so it
 * persists across view switches; this component remounts per view (keyed).
 */
export function ViewShell({
  databaseId,
  view,
  search,
  filterToMatches,
  matchedIds,
  flashId,
  searchSlot,
  activeId,
  setActiveId,
}: {
  databaseId: string;
  view: View;
  search: string;
  filterToMatches: boolean;
  matchedIds: Set<string> | null;
  flashId: string | null;
  searchSlot?: React.ReactNode;
  activeId: string;
  setActiveId: (id: string) => void;
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
  const [limit, setLimit] = useState<number>(cfg.limit ?? 10);
  const [presets, setPresets] = useState<Preset[]>(cfg.presets ?? []);
  const [activePreset, setActivePreset] = useState<string | null>(
    cfg.activePreset ?? null,
  );
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);
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
      presets,
      activePreset,
      limit,
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
    presets,
    activePreset,
    limit,
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
    setHidden,
    limit,
    search,
    filterToMatches,
    matchedIds,
    flashId,
  };

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

  const groupName = fields.find((f) => f.id === groupFieldId)?.name;
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
      {/* Toolbar: Quick View (left) · Filter/Sort/Group + search + Customize (right) */}
      <div className="flex shrink-0 items-center gap-1">
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

        <div className="ml-auto flex items-center gap-1">
          <button onClick={openQuick("filter")} className={quickCls(nRules > 0)}>
            <ListFilter className="size-4" />
            Filter{nRules > 0 ? ` · ${nRules}` : ""}
          </button>
          {view.type === "table" && (
            <>
              <button onClick={openQuick("sort")} className={quickCls(sorts.length > 0)}>
                <ArrowUpDown className="size-4" />
                Sort{sorts.length > 0 ? ` · ${sorts.length}` : ""}
              </button>
              <button onClick={openQuick("group")} className={quickCls(!!groupFieldId)}>
                <GroupIcon className="size-4" />
                {groupName ? `Group: ${groupName}` : "Group"}
              </button>
            </>
          )}
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
                  groupFieldId={groupFieldId}
                  setGroupFieldId={setGroupFieldId}
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
              hidden={hidden}
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
          />
        )}
      </div>
    </div>
  );
}
