"use client";

import { Check, Database, Globe2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourceAccess } from "@/components/access/resource-access";
import {
  DesignImporter,
  type DesignImportPayload,
} from "@/components/sites/design-importer";
import { WebDesigner } from "@/components/sites/web-designer";
import { Dropdown, MultiDropdown } from "@/components/ui/dropdown";
import { API_BASE_URL, apiFetch } from "@/lib/api/client";
import { defaultDesignerContent, type GrapesContent } from "@/lib/site-designer";

type Site = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  homepage_path: string;
  published: boolean;
};
type SitePage = {
  id: string;
  site_id: string;
  title: string;
  path: string;
  content: Record<string, unknown>;
  is_published: boolean;
  order: number;
};
type Binding = {
  id: string;
  site_id: string;
  page_id: string | null;
  database_id: string;
  key: string;
  name: string;
  field_ids: string[];
  expose_public: boolean;
};
type Db = { id: string; name: string };
type Field = { id: string; name: string; type: string };

function normalizePath(value: string): string {
  const clean = `/${value.trim().replace(/^\/+|\/+$/g, "")}`;
  return clean === "/" ? "/" : clean;
}

function BindingCreator({
  siteId,
  pages,
  onDone,
}: {
  siteId: string;
  pages: SitePage[];
  onDone: () => void;
}) {
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [pageId, setPageId] = useState<string | null>(pages[0]?.id ?? null);
  const [name, setName] = useState("Public data");
  const [key, setKey] = useState("items");
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const { data: databases = [] } = useQuery<Db[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Db[]>("/databases"),
  });
  const { data: fields = [] } = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
    enabled: Boolean(databaseId),
  });
  const createBinding = useMutation({
    mutationFn: () =>
      apiFetch<Binding>(`/sites/${siteId}/bindings`, {
        method: "POST",
        body: JSON.stringify({
          database_id: databaseId,
          page_id: pageId,
          name,
          key,
          field_ids: fieldIds,
          query: { page: 1, page_size: 20 },
        }),
      }),
    onSuccess: onDone,
  });

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">Add public data binding</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Select exactly which database fields may be exposed through the public runtime.
      </p>
      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-9 rounded-md border px-3 text-sm outline-none focus:border-blue-400"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Runtime key
            <input
              value={key}
              onChange={(event) =>
                setKey(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
              }
              className="h-9 rounded-md border px-3 text-sm outline-none focus:border-blue-400"
            />
          </label>
        </div>
        <div className="grid gap-1.5 text-xs font-medium">
          Page
          <div className="rounded-md border">
            <Dropdown
              value={pageId}
              placeholder="Global binding"
              options={pages.map((page) => ({
                value: page.id,
                label: `${page.title} · ${page.path}`,
              }))}
              onChange={setPageId}
            />
          </div>
        </div>
        <div className="grid gap-1.5 text-xs font-medium">
          Database
          <div className="rounded-md border">
            <Dropdown
              value={databaseId}
              allowClear={false}
              placeholder="Select database"
              options={databases.map((database) => ({
                value: database.id,
                label: database.name,
              }))}
              onChange={(value) => {
                setDatabaseId(value);
                setFieldIds([]);
              }}
            />
          </div>
        </div>
        <div className="grid gap-1.5 text-xs font-medium">
          Public fields
          <div className="rounded-md border">
            <MultiDropdown
              values={fieldIds}
              placeholder="Choose fields"
              options={fields.map((field) => ({
                value: field.id,
                label: `${field.name} (${field.type})`,
              }))}
              onChange={setFieldIds}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={
            !databaseId ||
            !name.trim() ||
            !key.trim() ||
            fieldIds.length === 0 ||
            createBinding.isPending
          }
          onClick={() => createBinding.mutate()}
          className="justify-self-start rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Create binding
        </button>
      </div>
    </section>
  );
}

export function SiteManager({ siteId }: { siteId: string }) {
  const queryClient = useQueryClient();
  const [newPath, setNewPath] = useState("/new-page");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const { data: site, isLoading } = useQuery<Site>({
    queryKey: ["site", siteId],
    queryFn: () => apiFetch<Site>(`/sites/${siteId}`),
  });
  const { data: pages = [] } = useQuery<SitePage[]>({
    queryKey: ["site-pages", siteId],
    queryFn: () => apiFetch<SitePage[]>(`/sites/${siteId}/pages`),
  });
  const { data: bindings = [] } = useQuery<Binding[]>({
    queryKey: ["site-bindings", siteId],
    queryFn: () => apiFetch<Binding[]>(`/sites/${siteId}/bindings`),
  });
  const publish = useMutation({
    mutationFn: (published: boolean) =>
      apiFetch<Site>(`/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify({ published }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site", siteId] });
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
  const updateSite = useMutation({
    mutationFn: (payload: Partial<Site>) =>
      apiFetch<Site>(`/sites/${siteId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site", siteId] }),
  });
  const createPage = useMutation({
    mutationFn: () =>
      apiFetch<SitePage>(`/sites/${siteId}/pages`, {
        method: "POST",
        body: JSON.stringify({
          title: normalizePath(newPath).slice(1) || "Home",
          path: normalizePath(newPath),
          content: defaultDesignerContent(normalizePath(newPath).slice(1) || "Home"),
        }),
      }),
    onSuccess: () => {
      setNewPath("/new-page");
      queryClient.invalidateQueries({ queryKey: ["site-pages", siteId] });
    },
  });
  const updatePage = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<SitePage> }) =>
      apiFetch<SitePage>(`/site-pages/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-pages", siteId] }),
  });
  const importDesign = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DesignImportPayload }) =>
      apiFetch<SitePage>(`/site-pages/${id}/import-design`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (page) => {
      setActivePageId(page.id);
      queryClient.invalidateQueries({ queryKey: ["site-pages", siteId] });
    },
  });
  const deleteBinding = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/site-bindings/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["site-bindings", siteId] }),
  });
  const bindingsByPage = useMemo(() => {
    const map: Record<string, Binding[]> = {};
    for (const binding of bindings) {
      const key = binding.page_id ?? "global";
      map[key] = [...(map[key] ?? []), binding];
    }
    return map;
  }, [bindings]);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activeBindings = useMemo(
    () =>
      bindings.filter(
        (binding) => binding.page_id === null || binding.page_id === activePage?.id,
      ),
    [activePage?.id, bindings],
  );
  const activePageSourceKey = useMemo(() => {
    if (!activePage) return "";
    const meta =
      activePage.content.meta &&
      typeof activePage.content.meta === "object" &&
      !Array.isArray(activePage.content.meta)
        ? (activePage.content.meta as Record<string, unknown>)
        : {};
    return [
      activePage.id,
      activePage.content.version,
      meta.imported_at,
      meta.saved_at,
      activeBindings.map((binding) => binding.key).join("|"),
    ]
      .filter(Boolean)
      .join(":");
  }, [activeBindings, activePage]);

  if (isLoading || !site) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <LoaderCircle className="mr-2 size-5 animate-spin" /> Loading site…
      </div>
    );
  }

  const publicSiteUrl = `${API_BASE_URL}/public/sites/${site.slug}`;

  return (
    <div className="min-h-full bg-[#fafbfc]">
      <header className="flex min-h-14 items-center gap-3 border-b bg-background px-5 py-2">
        <Globe2 className="size-5 text-blue-600" />
        <div className="min-w-0 flex-1">
          <input
            defaultValue={site.name}
            aria-label="Site name"
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== site.name) updateSite.mutate({ name });
            }}
            className="block w-full truncate bg-transparent text-base font-semibold outline-none"
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{publicSiteUrl}</span>
            {site.published && <Check className="size-3.5 text-emerald-600" />}
          </div>
        </div>
        <ResourceAccess resourceType="site" resourceId={siteId} resourceLabel="Site" />
        <button
          type="button"
          disabled={publish.isPending}
          onClick={() => publish.mutate(!site.published)}
          className={`rounded-md px-3 py-2 text-xs font-semibold ${
            site.published
              ? "border bg-background text-foreground"
              : "bg-primary text-white"
          }`}
        >
          {site.published ? "Unpublish" : "Publish"}
        </button>
      </header>
      <main className="grid gap-5 p-5 xl:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <div>
                <h2 className="text-sm font-semibold">Pages</h2>
                <p className="text-xs text-muted-foreground">
                  Select a page and design its GrapesJS source below.
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <input
                  value={newPath}
                  onChange={(event) => setNewPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") createPage.mutate();
                  }}
                  className="h-8 w-40 rounded-md border px-2 text-sm outline-none focus:border-blue-400"
                />
                <button
                  type="button"
                  disabled={createPage.isPending}
                  onClick={() => createPage.mutate()}
                  className="flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Plus className="size-3.5" /> Page
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              {pages.map((page) => (
                <article key={page.id} className="rounded-lg border bg-background p-3">
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_auto_auto]">
                    <input
                      defaultValue={page.title}
                      aria-label="Page title"
                      onBlur={(event) => {
                        const title = event.target.value.trim();
                        if (title && title !== page.title) {
                          updatePage.mutate({ id: page.id, payload: { title } });
                        }
                      }}
                      className="rounded-md border px-2 py-1.5 text-sm font-medium outline-none focus:border-blue-400"
                    />
                    <input
                      defaultValue={page.path}
                      aria-label="Page path"
                      onBlur={(event) => {
                        const path = normalizePath(event.target.value);
                        if (path !== page.path) {
                          updatePage.mutate({ id: page.id, payload: { path } });
                        }
                      }}
                      className="rounded-md border px-2 py-1.5 text-sm outline-none focus:border-blue-400"
                    />
                    <button
                      type="button"
                      onClick={() => setActivePageId(page.id)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                        activePage?.id === page.id
                          ? "bg-blue-50 text-blue-700"
                          : "border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Design
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updatePage.mutate({
                          id: page.id,
                          payload: { is_published: !page.is_published },
                        })
                      }
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                        page.is_published
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {page.is_published ? "Published" : "Draft"}
                    </button>
                  </div>
                  <div className="mt-3 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Source:{" "}
                    <span className="font-medium text-foreground">
                      {String(page.content.type ?? "json")}
                    </span>
                    {page.content.version ? ` · ${String(page.content.version)}` : ""}
                  </div>
                  {(bindingsByPage[page.id] ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(bindingsByPage[page.id] ?? []).map((binding) => (
                        <span
                          key={binding.id}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                        >
                          {binding.key}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
          {activePage && (
            <DesignImporter
              page={activePage}
              importing={importDesign.isPending}
              onImport={(payload) =>
                importDesign.mutate({
                  id: activePage.id,
                  payload,
                })
              }
            />
          )}
          {activePage && (
            <WebDesigner
              key={activePageSourceKey}
              page={activePage}
              bindings={activeBindings}
              saving={updatePage.isPending}
              onSave={(content: GrapesContent) =>
                updatePage.mutate({
                  id: activePage.id,
                  payload: { content },
                })
              }
            />
          )}
        </section>
        <aside className="space-y-4">
          <BindingCreator
            siteId={siteId}
            pages={pages}
            onDone={() =>
              queryClient.invalidateQueries({ queryKey: ["site-bindings", siteId] })
            }
          />
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold">Public bindings</h2>
            <div className="mt-3 space-y-2">
              {bindings.map((binding) => (
                <div
                  key={binding.id}
                  className="flex items-center gap-2 rounded-lg border bg-background p-2"
                >
                  <Database className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{binding.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      /bindings/{binding.key} · {binding.field_ids.length} fields
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteBinding.mutate(binding.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {!bindings.length && (
                <p className="rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">
                  No public data bindings yet.
                </p>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
