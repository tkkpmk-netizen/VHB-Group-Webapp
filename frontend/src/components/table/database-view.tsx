"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { SearchBar } from "@/components/table/search-box";
import { ViewsBar } from "@/components/table/views-bar";
import { ViewShell } from "@/components/table/view-shell";
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
    queryKey: ["rows", databaseId],
    queryFn: () => apiFetch<Row[]>(`/databases/${databaseId}/rows`),
  });

  const dbName = dbQ.data?.find((d) => d.id === databaseId)?.name ?? "Database";
  const views = viewsQ.data ?? [];
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">
        <Link
          href="/databases"
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Databases
        </Link>
        <h1 className="text-2xl font-bold">{dbName}</h1>
      </div>

      {active ? (
        <>
          {/* Layout (tabs) row — search bar sits opposite, on the right. */}
          <div className="flex shrink-0 flex-col gap-2 border-b pb-2 xl:flex-row xl:items-end xl:justify-between xl:pb-0">
            <div className="min-w-0 overflow-x-auto pb-1 xl:pb-0">
              <ViewsBar
                databaseId={databaseId}
                views={views}
                activeId={active.id}
                setActiveId={setActiveId}
              />
            </div>
            <div className="w-full shrink-0 xl:w-80 xl:pb-1">
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
