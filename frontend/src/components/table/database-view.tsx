"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, X } from "lucide-react";
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
  const [searchOpen, setSearchOpen] = useState(false);
  // Search is database-level (persists across view switches) → lives in the top bar.
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

  // Search across all rows; scope narrows to one field.
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const searchActive = search.trim().length > 0;
  const searchFields = scopeFieldId && byId[scopeFieldId] ? [byId[scopeFieldId]] : fields;
  const hits = searchActive ? searchHits(rowsQ.data ?? [], searchFields, search) : [];
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

  // Collapsible search element, rendered inside the toolbar (next to Customize).
  const searchSlot = searchOpen ? (
    <div className="flex items-center gap-1">
      <div className="w-[22rem] max-w-[38vw]">
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
      <button
        onClick={() => {
          setSearchOpen(false);
          setSearch("");
          setFilterToMatches(false);
        }}
        title="Close search"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
      >
        <X className="size-4" />
      </button>
    </div>
  ) : (
    <button
      onClick={() => setSearchOpen(true)}
      title="Search"
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
    >
      <Search className="size-4" />
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
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
          <div className="mt-2 shrink-0 overflow-x-auto">
            <ViewsBar
              databaseId={databaseId}
              views={views}
              activeId={active.id}
              setActiveId={setActiveId}
            />
          </div>

          <ViewShell
            key={active.id}
            databaseId={databaseId}
            view={active}
            search={search}
            filterToMatches={filterToMatches}
            matchedIds={matchedIds}
            flashId={flashId}
            searchSlot={searchSlot}
            activeId={active.id}
            setActiveId={setActiveId}
          />
        </>
      ) : (
        <div className="p-8 text-sm text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}
