"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, ListFilter, SlidersHorizontal } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { BoardView } from "@/components/table/board-view";
import { SearchBar } from "@/components/table/search-box";
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

  // Search (database-level, not persisted) + settings panel.
  const [search, setSearch] = useState("");
  const [scopeFieldId, setScopeFieldId] = useState<string | null>(null);
  const [filterToMatches, setFilterToMatches] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(null);

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
