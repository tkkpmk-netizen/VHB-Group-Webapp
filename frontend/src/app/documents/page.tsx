"use client";

import { FileText, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/app-shell";
import { apiFetch, getWorkspaceId } from "@/lib/api/client";

type DocumentItem = {
  id: string;
  title: string;
  icon: string | null;
  version: number;
};

export default function DocumentsPage() {
  const queryClient = useQueryClient();
  const workspaceId = getWorkspaceId();
  const [search, setSearch] = useState("");
  const { data: documents = [], isLoading } = useQuery<DocumentItem[]>({
    queryKey: ["documents", workspaceId],
    queryFn: () => apiFetch<DocumentItem[]>("/documents"),
  });
  const createDocument = useMutation({
    mutationFn: () =>
      apiFetch<DocumentItem>("/documents", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled" }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return documents.filter(
      (document) => !needle || document.title.toLowerCase().includes(needle),
    );
  }, [documents, search]);

  return (
    <AppShell>
      <div className="min-h-full">
        <header className="flex min-h-14 items-center gap-3 border-b px-5 py-2">
          <div>
            <h1 className="text-base font-semibold">Documents</h1>
            <p className="text-xs text-muted-foreground">
              Block-based workspace knowledge.
            </p>
          </div>
          <button
            type="button"
            onClick={() => createDocument.mutate()}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus className="size-4" /> New document
          </button>
        </header>
        <div className="mx-auto max-w-6xl p-6">
          <label className="mb-4 flex h-9 max-w-sm items-center gap-2 rounded-md border px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <div className="overflow-hidden rounded-lg border">
            {isLoading && (
              <p className="p-5 text-sm text-muted-foreground">Loading…</p>
            )}
            {visible.map((document) => (
              <Link
                key={document.id}
                href={`/documents/${document.id}`}
                className="flex items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-[#f7faff]"
              >
                <span className="flex size-8 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                  {document.icon ?? <FileText className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {document.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  v{document.version}
                </span>
              </Link>
            ))}
            {!isLoading && !visible.length && (
              <div className="p-12 text-center text-sm text-muted-foreground">
                No documents yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
