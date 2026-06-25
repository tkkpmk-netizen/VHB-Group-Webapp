"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database as DatabaseIcon, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Db = components["schemas"]["DatabaseOut"];

export default function DatabasesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const { data: databases, isLoading } = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });

  const createMutation = useMutation({
    mutationFn: (newName: string) =>
      apiFetch<Db>("/databases", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["databases"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/databases/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["databases"] }),
  });

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) createMutation.mutate(name.trim());
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Databases</h1>
          <p className="text-muted-foreground">
            Create and manage Notion-style databases.
          </p>
        </div>

        <form onSubmit={onCreate} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New database name (e.g. CRM, Orders…)"
            className="flex-1 rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={createMutation.isPending || !name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="size-4" />
            Create
          </button>
        </form>

        <div className="space-y-2">
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {databases?.length === 0 && (
            <div className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">
              No databases yet. Create your first one above.
            </div>
          )}
          {databases?.map((db) => (
            <div
              key={db.id}
              className="flex items-center justify-between rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
            >
              <Link
                href={`/databases/${db.id}`}
                className="flex flex-1 items-center gap-3"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  {db.icon ?? <DatabaseIcon className="size-4" />}
                </div>
                <span className="font-medium">{db.name}</span>
              </Link>
              <button
                onClick={() => deleteMutation.mutate(db.id)}
                title="Delete"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
