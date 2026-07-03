"use client";

import {
  Database as DatabaseIcon,
  Folder,
  LayoutGrid,
  List,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Db = components["schemas"]["DatabaseOut"];
type Space = components["schemas"]["SpaceOut"];
type FolderType = components["schemas"]["FolderOut"];

export default function DatabasesPage() {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [name, setName] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderSpaceId, setFolderSpaceId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  const { data: databases = [], isLoading } = useQuery<Db[]>({
    queryKey: ["databases", workspaceId],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ["spaces", workspaceId],
    queryFn: () => apiFetch<Space[]>("/spaces"),
  });
  const { data: folders = [] } = useQuery<FolderType[]>({
    queryKey: ["all-folders", workspaceId, spaces.map((space) => space.id)],
    queryFn: async () =>
      (
        await Promise.all(
          spaces.map((space) =>
            apiFetch<FolderType[]>(`/spaces/${space.id}/folders`),
          ),
        )
      ).flat(),
    enabled: spaces.length > 0,
  });
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return databases.filter(
      (database) => !needle || database.name.toLowerCase().includes(needle),
    );
  }, [databases, search]);

  const createDatabase = useMutation({
    mutationFn: (newName: string) =>
      apiFetch<Db>("/databases", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: () => {
      setName("");
      setShowCreate(false);
      queryClient.invalidateQueries({ queryKey: ["databases"] });
    },
  });
  const createSpace = useMutation({
    mutationFn: (newName: string) =>
      apiFetch<Space>("/spaces", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: () => {
      setSpaceName("");
      queryClient.invalidateQueries({ queryKey: ["spaces"] });
    },
  });
  const createFolder = useMutation({
    mutationFn: ({ spaceId, name }: { spaceId: string; name: string }) =>
      apiFetch<FolderType>(`/spaces/${spaceId}/folders`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setFolderName("");
      setFolderSpaceId(null);
      queryClient.invalidateQueries({ queryKey: ["all-folders"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    },
  });

  return (
    <AppShell>
      <div className="flex min-h-full flex-col">
        <header className="flex min-h-14 items-center gap-3 border-b px-5 py-2">
          <div>
            <h1 className="text-base font-semibold">Spaces & databases</h1>
            <p className="text-xs text-muted-foreground">
              Organize the data foundation for every mini app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-[#0b8ff3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#087bd1]"
          >
            <Plus className="size-4" /> New database
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-5 p-5 lg:p-7">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Workspace spaces</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (spaceName.trim()) createSpace.mutate(spaceName.trim());
                }}
                className="flex gap-2"
              >
                <input
                  value={spaceName}
                  onChange={(event) => setSpaceName(event.target.value)}
                  placeholder="New space"
                  className="h-8 w-40 rounded-md border px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!spaceName.trim()}
                  className="rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Add
                </button>
              </form>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {spaces.map((space) => {
                const spaceFolders = folders.filter(
                  (folder) => folder.space_id === space.id,
                );
                return (
                  <article
                    key={space.id}
                    className="rounded-lg border bg-card p-4 hover:border-[#89bfff] hover:shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 items-center justify-center rounded-lg bg-[#eee8ff]">
                        {space.icon ?? "🗂️"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold">
                          {space.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {spaceFolders.length} folders
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Add folder"
                        onClick={() => setFolderSpaceId(space.id)}
                        className="rounded p-1 hover:bg-muted"
                      >
                        <Plus className="size-4 text-muted-foreground" />
                      </button>
                    </div>
                    {folderSpaceId === space.id && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (folderName.trim())
                            createFolder.mutate({
                              spaceId: space.id,
                              name: folderName.trim(),
                            });
                        }}
                        className="mt-3 flex gap-1.5"
                      >
                        <input
                          autoFocus
                          value={folderName}
                          onChange={(event) => setFolderName(event.target.value)}
                          placeholder="Folder name"
                          className="h-8 min-w-0 flex-1 rounded-md border px-2 text-xs outline-none"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-primary px-2 text-xs font-medium text-white"
                        >
                          Add
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-sm font-semibold">
                All databases <span className="text-muted-foreground">{databases.length}</span>
              </h2>
              <label className="flex h-8 items-center gap-2 rounded-md border px-2.5">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search databases"
                  className="w-40 bg-transparent text-xs outline-none"
                />
              </label>
              <button type="button" className="rounded-md border p-1.5">
                <List className="size-4" />
              </button>
              <button type="button" className="rounded-md p-1.5 text-muted-foreground">
                <LayoutGrid className="size-4" />
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[minmax(220px,1.5fr)_minmax(140px,1fr)_120px] border-b bg-[#fafbfc] px-4 py-2.5 text-xs text-muted-foreground">
                <span>Name</span>
                <span>Location</span>
                <span>Type</span>
              </div>
              {isLoading && <p className="p-5 text-sm text-muted-foreground">Loading…</p>}
              {visible.map((database) => {
                const folder = folders.find(
                  (item) => item.id === database.folder_id,
                );
                return (
                  <Link
                    key={database.id}
                    href={`/databases/${database.id}`}
                    className="grid grid-cols-[minmax(220px,1.5fr)_minmax(140px,1fr)_120px] items-center border-b px-4 py-3 text-sm last:border-b-0 hover:bg-[#f7faff]"
                  >
                    <span className="flex min-w-0 items-center gap-3 font-medium">
                      <span className="flex size-8 items-center justify-center rounded-md bg-[#e8f1ff] text-[#1264d7]">
                        {database.icon ?? <DatabaseIcon className="size-4" />}
                      </span>
                      <span className="truncate">{database.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                      {folder && <Folder className="size-3.5" />}
                      {folder?.name ?? "Workspace root"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Dynamic database
                    </span>
                  </Link>
                );
              })}
              {!isLoading && !visible.length && (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No databases found.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 p-4">
          <button
            type="button"
            aria-label="Close create dialog"
            className="absolute inset-0"
            onClick={() => setShowCreate(false)}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) createDatabase.mutate(name.trim());
            }}
            className="relative z-10 w-full max-w-md rounded-xl border bg-card p-5 shadow-2xl"
          >
            <h2 className="text-base font-semibold">Create database</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This database can power documents, dashboards, and published sites.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Database name"
              className="mt-5 h-10 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || createDatabase.isPending}
                className="rounded-md bg-[#0b8ff3] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Create database
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
