"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Database as DatabaseIcon, MoreHorizontal, Star } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { SearchBar } from "@/components/table/search-box";
import { ViewsBar } from "@/components/table/views-bar";
import { ViewShell } from "@/components/table/view-shell";
import { DatabaseAccess } from "@/components/table/database-access";
import { DatabaseTransfers } from "@/components/table/database-transfers";
import { matchedRowIds, searchHits } from "@/lib/search";
import type { components } from "@/lib/api/schema";

type View = components["schemas"]["ViewOut"];
type Db = components["schemas"]["DatabaseOut"];
type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Search lives here so it can sit on the Layout (tabs) row, opposite the tabs.
  const [search, setSearch] = useState("");
  const [scopeFieldId, setScopeFieldId] = useState<string | null>(null);
  const [filterToMatches, setFilterToMatches] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

  const dbQ = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const viewsQ = useQuery<View[]>({
    queryKey: ["views", databaseId],
    queryFn: () => apiFetch<View[]>(`/databases/${databaseId}/views`),
  });
  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const rowsQ = useQuery<Row[]>({
    queryKey: ["rows-search", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
    enabled: search.trim().length > 0,
  });

  const dbName = dbQ.data?.find((d) => d.id === databaseId)?.name ?? "Database";
  const views = useMemo(() => viewsQ.data ?? [], [viewsQ.data]);
  const active = views.find((v) => v.id === activeId) ?? views[0];
  const fields = fieldsQ.data ?? [];
  const rows = rowsQ.data ?? [];

  // Search over all rows; scope narrows to one field.
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const searchActive = search.trim().length > 0;
  const searchFields =
    scopeFieldId && byId[scopeFieldId] ? [byId[scopeFieldId]] : fields;
  const hits = searchActive ? searchHits(rows, searchFields, search) : [];
  const matchedIds = searchActive ? matchedRowIds(hits) : null;

  useEffect(() => {
    const shortcuts: Record<string, View["type"]> = {
      t: "table",
      b: "board",
      l: "list",
      c: "calendar",
      g: "gallery",
      y: "gantt",
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      )
        return;
      const type = shortcuts[e.key.toLowerCase()];
      const targetView = type && views.find((v) => v.type === type);
      if (targetView) {
        e.preventDefault();
        setActiveId(targetView.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [views]);

  function jumpToRow(id: string) {
    setFlashId(id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Link
          href="/databases"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <DatabaseIcon className="size-3.5 text-violet-600" />
          Databases
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-semibold">{dbName}</h1>
        <button type="button" title="Favorite" className="rounded p-1 hover:bg-muted">
          <Star className="size-3.5 text-muted-foreground" />
        </button>
        <div className="ml-auto flex items-center gap-2">
          <DatabaseTransfers databaseId={databaseId} />
          <DatabaseAccess databaseId={databaseId} />
          <button type="button" title="More actions" className="rounded p-1.5 hover:bg-muted">
            <MoreHorizontal className="size-4" />
          </button>
        </div>
      </div>

      {active ? (
        <>
          {/* Layout (tabs) row — search bar sits opposite, on the right. */}
          <div className="flex shrink-0 flex-col gap-2 border-b px-3 pt-1 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 overflow-x-auto">
              <ViewsBar
                databaseId={databaseId}
                views={views}
                activeId={active.id}
                setActiveId={setActiveId}
              />
            </div>
            <div className="w-full shrink-0 pb-1 xl:w-80">
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
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <ViewShell
              key={active.id}
              databaseId={databaseId}
              view={active}
              views={views}
              activeId={active.id}
              setActiveId={setActiveId}
              search={search}
              filterToMatches={filterToMatches}
              matchedIds={matchedIds}
              flashId={flashId}
            />
          </div>
        </>
      ) : (
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
