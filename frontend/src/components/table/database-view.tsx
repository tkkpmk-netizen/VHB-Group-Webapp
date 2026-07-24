"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FaIcon, MoreHorizontal, Search, Star, Workflow } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { SearchBar } from "@/components/table/search-box";
import { ViewsBar } from "@/components/table/views-bar";
import { ViewShell } from "@/components/table/view-shell";
import { ResourceAccess } from "@/components/access/resource-access";
import { DatabaseTransfers } from "@/components/table/database-transfers";
import { matchedEntityIds, searchHits } from "@/lib/search";
import type { components } from "@/lib/api/schema";
import { DEFAULT_ICONS } from "@/lib/icon-system";

type Layout = components["schemas"]["LayoutOut"];
type Db = components["schemas"]["DatabaseOut"];
type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];
type Space = components["schemas"]["SpaceOut"];
type Folder = components["schemas"]["FolderOut"];
type Placement = components["schemas"]["SpaceDatabaseOut"];

export function DatabaseView({
  databaseId,
  placementId,
  initialLayoutId,
}: {
  databaseId: string;
  placementId?: string;
  initialLayoutId?: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialLayoutId ?? null);
  // Search lives here so it can sit on the Layout (tabs) row, opposite the tabs.
  const [search, setSearch] = useState("");
  const [scopeFieldId, setScopeFieldId] = useState<string | null>(null);
  const [filterToMatches, setFilterToMatches] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const qc = useQueryClient();

  const dbQ = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const layoutsQ = useQuery<Layout[]>({
    queryKey: ["layouts", databaseId, placementId ?? "canonical"],
    queryFn: () =>
      apiFetch<Layout[]>(
        `/databases/${databaseId}/layouts${placementId ? `?placement_id=${placementId}` : ""}`,
      ),
  });
  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
  const entitiesQ = useQuery<Entity[]>({
    queryKey: ["entities-search", databaseId],
    queryFn: () => apiFetch<Entity[]>(`/databases/${databaseId}/entities`),
    enabled: search.trim().length > 0,
  });
  const spacesQ = useQuery<Space[]>({
    queryKey: ["spaces"],
    queryFn: () => apiFetch<Space[]>("/spaces"),
  });
  const foldersQ = useQuery<Record<string, Folder[]>>({
    queryKey: ["folders", "database-locations", spacesQ.data?.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          (spacesQ.data ?? []).map(async (space) => [
            space.id,
            await apiFetch<Folder[]>(`/spaces/${space.id}/folders`),
          ]),
        ),
      ),
    enabled: Boolean(spacesQ.data?.length),
  });
  const placementsQ = useQuery<Record<string, Placement[]>>({
    queryKey: ["space-databases", "database-locations", spacesQ.data?.map((space) => space.id)],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          (spacesQ.data ?? []).map(async (space) => [
            space.id,
            await apiFetch<Placement[]>(`/spaces/${space.id}/databases`),
          ]),
        ),
      ),
    enabled: Boolean(spacesQ.data?.length),
  });

  const database = dbQ.data?.find((d) => d.id === databaseId);
  const dbName = database?.name ?? "Database";
  const [description, setDescription] = useState("");
  const layouts = useMemo(() => layoutsQ.data ?? [], [layoutsQ.data]);
  const active = layouts.find((v) => v.id === activeId) ?? layouts[0];
  const fields = fieldsQ.data ?? [];
  const entities = entitiesQ.data ?? [];
  const locationPaths = useMemo(() => {
    const paths: { space: Space; folders: Folder[] }[] = [];
    for (const space of spacesQ.data ?? []) {
      const placement = (placementsQ.data?.[space.id] ?? []).find(
        (candidate) =>
          candidate.database_id === databaseId &&
          (!placementId || candidate.id === placementId),
      );
      if (!placement) continue;
      const folders = foldersQ.data?.[space.id] ?? [];
      const chain: Folder[] = [];
      let current = folders.find((folder) => folder.id === placement.folder_id);
      const visited = new Set<string>();
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        chain.unshift(current);
        current = folders.find((folder) => folder.id === current?.parent_id);
      }
      paths.push({ space, folders: chain });
    }
    return paths;
  }, [databaseId, foldersQ.data, placementId, placementsQ.data, spacesQ.data]);

  // Search over all entities; scope narrows to one field.
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  const searchActive = search.trim().length > 0;
  const searchFields =
    scopeFieldId && byId[scopeFieldId] ? [byId[scopeFieldId]] : fields;
  const hits = searchActive ? searchHits(entities, searchFields, search) : [];
  const matchedIds = searchActive ? matchedEntityIds(hits) : null;

  const saveDescription = useMutation({
    mutationFn: (value: string) =>
      apiFetch<Db>(`/databases/${databaseId}`, {
        method: "PATCH",
        body: JSON.stringify({ description: value || null }),
      }),
    onSuccess: () => {
      setEditingDescription(false);
      qc.invalidateQueries({ queryKey: ["databases"] });
    },
  });
  const toggleFavorite = useMutation({
    mutationFn: (favorite: boolean) =>
      placementId
        ? apiFetch<void>(`/space-databases/${placementId}`, {
            method: "PATCH",
            body: JSON.stringify({ settings: { ...(activePlacement?.settings ?? {}), favorite: !favorite } }),
          })
        : apiFetch<void>(`/databases/${databaseId}/favorite`, {
            method: favorite ? "DELETE" : "PUT",
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["databases"] });
      qc.invalidateQueries({ queryKey: ["space-databases"] });
    },
  });
  const activePlacement = Object.values(placementsQ.data ?? {})
    .flat()
    .find((item) => item.id === placementId);
  const isFavorite = placementId
    ? (activePlacement?.settings as { favorite?: boolean } | undefined)?.favorite === true
    : database?.is_favorite;

  useEffect(() => {
    const shortcuts: Record<string, Layout["type"]> = {
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
      const targetLayout = type && layouts.find((v) => v.type === type);
      if (targetLayout) {
        e.preventDefault();
        setActiveId(targetLayout.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layouts]);

  function jumpToEntity(id: string) {
    setFlashId(id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-row-id="${id}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1500);
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b">
        <div className="flex h-7 min-w-0 items-center gap-1.5 overflow-x-auto px-4 text-[10px] text-muted-foreground lg:px-5">
          {locationPaths.length ? (
            locationPaths.map((path) => (
              <span key={path.space.id} className="flex shrink-0 items-center gap-1">
                <Link
                  href={`/databases?space=${path.space.id}`}
                  className="flex items-center gap-1 font-medium text-[#1264d7] hover:underline"
                >
                  <FaIcon
                    name={path.space.icon || DEFAULT_ICONS.space}
                    className="size-3"
                    style={{ color: path.space.color ?? "var(--icon-space)" }}
                  />
                  {path.space.name}
                </Link>
                {path.folders.map((folder) => (
                  <span key={folder.id} className="flex items-center gap-1">
                    <span>/</span>
                    <FaIcon
                      name={folder.icon || DEFAULT_ICONS.folder}
                      className="size-3 text-[var(--icon-folder)]"
                    />
                    <span>{folder.name}</span>
                  </span>
                ))}
                <span>/</span>
                <span className="max-w-40 truncate text-foreground">{dbName}</span>
                {locationPaths.length > 1 ? (
                  <span className="mx-1 text-[var(--border-strong)]">•</span>
                ) : null}
              </span>
            ))
          ) : (
            <>
              <Link href="/databases?view=all" className="font-medium text-[#1264d7] hover:underline">
                All Database
              </Link>
              <span>/</span>
              <span className="truncate text-foreground">{dbName}</span>
            </>
          )}
        </div>
        {!placementId && <div className="flex items-start gap-2.5 border-t px-4 py-2 lg:px-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-selected)]">
            <FaIcon name={database?.icon || DEFAULT_ICONS.database} className="size-4" style={{ color: database?.icon_color || "var(--icon-database)" }} />
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold tracking-[-0.02em] text-[#102447]">{dbName}</h1>
              <button
                type="button"
                title={isFavorite ? "Remove this Space view from favorites" : "Add this Space view to favorites"}
                aria-pressed={isFavorite ?? false}
                disabled={!database || toggleFavorite.isPending}
                onClick={() => toggleFavorite.mutate(isFavorite ?? false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-[#f0a12a] disabled:opacity-50"
              >
                <Star className={`size-3.5 ${isFavorite ? "fill-current text-[#f0a12a]" : ""}`} />
              </button>
            </div>
            {editingDescription ? (
              <input
                autoFocus
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => saveDescription.mutate(description.trim())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setDescription(database?.description ?? "");
                    setEditingDescription(false);
                  }
                }}
                placeholder="Add a database description"
                className="mt-0.5 w-full max-w-xl border-b bg-transparent py-0.5 text-xs text-muted-foreground outline-none focus:border-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDescription(database?.description ?? "");
                  setEditingDescription(true);
                }}
                className="mt-0.5 block text-left text-xs text-muted-foreground hover:text-foreground"
                title="Edit database description"
              >
                {database?.description || "Add a database description"}
              </button>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button type="button" title="More database actions" className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>}
      </header>

      {active ? (
        <>
          <div className="relative flex h-7 shrink-0 items-center gap-1 border-b px-[18px]">
            <div className="min-w-0 flex-1 self-end overflow-x-auto overflow-y-hidden">
              <ViewsBar
                databaseId={databaseId}
                placementId={placementId}
                views={layouts}
                activeId={active.id}
                setActiveId={setActiveId}
              />
            </div>
            <div className="relative ml-auto flex shrink-0 items-center gap-0.5 bg-white pl-2">
              <button
                type="button"
                title="Search database"
                onClick={() => setSearchOpen((open) => !open)}
                className={`flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground ${searchOpen ? "bg-muted text-foreground" : ""}`}
              >
                <Search className="size-3.5" />
              </button>
              <button
                type="button"
                title="Automation — coming soon"
                aria-label="Automation — coming soon"
                className="flex size-6 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted"
              >
                <Workflow className="size-3.5" />
              </button>
              <ResourceAccess
                resourceType="database"
                resourceId={databaseId}
                resourceLabel="Database"
                compact
              />
              <DatabaseTransfers databaseId={databaseId} compact />
              {searchOpen && (
                <div className="vhb-popover-shadow absolute right-0 top-[calc(100%+5px)] z-[60] w-[320px] rounded-lg border bg-card p-2 animate-in fade-in slide-in-from-top-1 duration-150">
                  <SearchBar
                    fields={fields}
                    hits={hits}
                    scopeFieldId={scopeFieldId}
                    setScopeFieldId={setScopeFieldId}
                    query={search}
                    setQuery={setSearch}
                    filterToMatches={filterToMatches}
                    setFilterToMatches={setFilterToMatches}
                    onJump={jumpToEntity}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <ViewShell
              key={active.id}
              databaseId={databaseId}
              view={active}
              views={layouts}
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
