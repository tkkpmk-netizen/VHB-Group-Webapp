"use client";

import { Globe2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";

type Site = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  published: boolean;
};

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled-site"
  );
}

export default function SitesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [name, setName] = useState("Untitled site");
  const { data: sites = [], isLoading } = useQuery<Site[]>({
    queryKey: ["sites", workspaceId],
    queryFn: () => apiFetch<Site[]>("/sites"),
  });
  const createSite = useMutation({
    mutationFn: () =>
      apiFetch<Site>("/sites", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim() || "Untitled site",
          slug: `${slugify(name)}-${Date.now().toString(36)}`,
        }),
      }),
    onSuccess: (site) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      router.push(`/sites/${site.id}`);
    },
  });

  return (
    <AppShell>
      <div className="min-h-full">
        <header className="flex min-h-14 items-center gap-3 border-b px-5 py-2">
          <div>
            <h1 className="text-base font-semibold">Sites</h1>
            <p className="text-xs text-muted-foreground">
              Manage publishable pages and public data bindings.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") createSite.mutate();
              }}
              className="h-9 w-52 rounded-md border px-3 text-sm outline-none focus:border-blue-400"
            />
            <button
              type="button"
              disabled={createSite.isPending}
              onClick={() => createSite.mutate()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="size-4" /> New site
            </button>
          </div>
        </header>
        <div className="mx-auto grid max-w-6xl gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <Link
              key={site.id}
              href={`/sites/${site.id}`}
              className="rounded-xl border bg-card p-5 transition hover:border-blue-300 hover:shadow-sm"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Globe2 className="size-5" />
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    site.published
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {site.published ? "Published" : "Draft"}
                </span>
              </div>
              <h2 className="truncate text-sm font-semibold">{site.name}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                /{site.slug}
              </p>
              <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">
                {site.description || "No description"}
              </p>
            </Link>
          ))}
          {!isLoading && sites.length === 0 && (
            <button
              type="button"
              onClick={() => createSite.mutate()}
              className="col-span-full rounded-xl border border-dashed p-14 text-sm text-muted-foreground hover:bg-muted/30"
            >
              Create your first site
            </button>
          )}
        </div>
      </div>
    </AppShell>
  );
}
