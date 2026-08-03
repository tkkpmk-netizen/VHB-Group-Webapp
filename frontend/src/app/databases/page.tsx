"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { ResourceAccess } from "@/components/access/resource-access";
import { Button } from "@/components/ui/button";
import {
  Copy,
  Database,
  FaIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "@/components/ui/fa-icon";
import { ApiError, apiFetch, getWorkspaceId } from "@/lib/api/client";
import { DEFAULT_ICONS } from "@/lib/icon-system";
import { workspaceQueryKeys } from "@/lib/query-keys";
import type { components } from "@/lib/api/schema";

type Db = components["schemas"]["DatabaseOut"];
type DialogState =
  | { kind: "create" }
  | { kind: "rename"; database: Db }
  | { kind: "delete"; database: Db };

function DatabaseDialog({
  state,
  onClose,
}: {
  state: DialogState;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [name, setName] = useState(
    state.kind === "rename" ? state.database.name : "",
  );
  const mutation = useMutation({
    mutationFn: async () => {
      if (state.kind === "create") {
        return apiFetch<Db>("/databases", {
          method: "POST",
          body: JSON.stringify({ name: name.trim() }),
        });
      }
      if (state.kind === "rename") {
        return apiFetch<Db>(`/databases/${state.database.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim() }),
        });
      }
      return apiFetch<void>(`/databases/${state.database.id}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.databases(workspaceId),
      });
      onClose();
    },
  });
  const title =
    state.kind === "create"
      ? "New database"
      : state.kind === "rename"
        ? "Rename database"
        : "Delete database";
  const error = mutation.error instanceof Error ? mutation.error.message : null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-dialog-title"
        className="relative w-full max-w-md rounded-xl border bg-card p-4 shadow-xl"
      >
        <h2 id="database-dialog-title" className="text-sm font-semibold">
          {title}
        </h2>
        {state.kind === "delete" ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Delete <strong className="text-foreground">{state.database.name}</strong> and
            all of its records? This cannot be undone.
          </p>
        ) : (
          <label className="mt-3 block text-xs font-medium">
            Database name
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && name.trim()) mutation.mutate();
                if (event.key === "Escape") onClose();
              }}
              className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="e.g. Product research"
            />
          </label>
        )}
        {error ? (
          <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant={state.kind === "delete" ? "destructive" : "default"}
            disabled={mutation.isPending || (state.kind !== "delete" && !name.trim())}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending
              ? "Saving…"
              : state.kind === "delete"
                ? "Delete database"
                : state.kind === "create"
                  ? "Create database"
                  : "Save"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function DatabaseMiniApp() {
  const workspaceId = getWorkspaceId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const databases = useQuery<Db[]>({
    queryKey: workspaceQueryKeys.databases(workspaceId),
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const duplicate = useMutation({
    mutationFn: (databaseId: string) =>
      apiFetch<Db>(`/databases/${databaseId}/duplicate`, { method: "POST" }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.databases(workspaceId),
      }),
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (databases.data ?? []).filter((database) =>
      database.name.toLowerCase().includes(needle),
    );
  }, [databases.data, search]);
  const error =
    databases.error instanceof ApiError
      ? databases.error.message
      : databases.error instanceof Error
        ? databases.error.message
        : duplicate.error instanceof Error
          ? duplicate.error.message
          : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-[64px] items-center gap-4 border-b bg-card px-4 py-3 lg:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-selected)] text-[#1264d7]">
          <Database className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-[#102447]">
            Database
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Create and manage reusable work areas for structured data.
          </p>
        </div>
        <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
          <Plus className="size-3.5" /> New database
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] min-h-0 flex-1 flex-col p-3 lg:p-4">
        <div className="mb-3 flex items-center gap-3">
          <label className="flex h-8 w-full max-w-[340px] items-center gap-2 rounded-md border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <Search className="size-3.5" />
            <span className="sr-only">Search databases</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search databases"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-xs"
            />
          </label>
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {filtered.length} database{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        {error ? (
          <div className="mb-3 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 overflow-auto rounded-xl border bg-card">
          <div className="grid h-9 grid-cols-[minmax(0,1fr)_140px] items-center border-b bg-muted/45 px-4 text-[11px] font-medium text-muted-foreground">
            <span>Database name</span>
            <span className="text-right">Actions</span>
          </div>
          {databases.isPending ? (
            <div className="space-y-1 p-3" aria-label="Loading databases">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-10 animate-pulse rounded-md bg-muted/50" />
              ))}
            </div>
          ) : null}
          {filtered.map((database) => (
            <div
              key={database.id}
              className="group grid min-h-12 grid-cols-[minmax(0,1fr)_140px] items-center border-b px-4 last:border-0 hover:bg-muted/45"
            >
              <Link
                href={`/databases/${database.id}`}
                className="flex min-w-0 items-center gap-3 py-2 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-selected)]">
                  <FaIcon
                    name={database.icon || DEFAULT_ICONS.database}
                    className="size-4"
                    style={{ color: database.icon_color || "var(--icon-database)" }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold">{database.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {database.description || "No description"}
                  </span>
                </span>
              </Link>
              <div className="flex items-center justify-end gap-0.5">
                <ResourceAccess
                  resourceType="database"
                  resourceId={database.id}
                  resourceLabel={database.name}
                  compact
                />
                <button
                  type="button"
                  title="Duplicate database"
                  aria-label={`Duplicate ${database.name}`}
                  onClick={() => duplicate.mutate(database.id)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Rename database"
                  aria-label={`Rename ${database.name}`}
                  onClick={() => setDialog({ kind: "rename", database })}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete database"
                  aria-label={`Delete ${database.name}`}
                  onClick={() => setDialog({ kind: "delete", database })}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
          {!databases.isPending && filtered.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Database className="size-5" />
              </span>
              <p className="mt-3 text-sm font-semibold">
                {search ? "No matching databases" : "No databases yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search ? "Try a different search." : "Create the first structured work area."}
              </p>
              {!search ? (
                <Button className="mt-4" size="sm" onClick={() => setDialog({ kind: "create" })}>
                  <Plus className="size-3.5" /> New database
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {dialog ? <DatabaseDialog state={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

export default function DatabasesPage() {
  return (
    <AppShell>
      <DatabaseMiniApp />
    </AppShell>
  );
}
