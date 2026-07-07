"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

const BlockDocumentEditor = dynamic(
  () =>
    import("@/components/documents/block-document-editor").then(
      (module) => module.BlockDocumentEditor,
    ),
  { ssr: false },
);

type DocumentData = {
  id: string;
  title: string;
  icon: string | null;
  content: Record<string, unknown>[];
  version: number;
};

export function DocumentClient({ documentId }: { documentId: string }) {
  const { data, isLoading } = useQuery<DocumentData>({
    queryKey: ["document", documentId],
    queryFn: () => apiFetch<DocumentData>(`/documents/${documentId}`),
  });
  if (isLoading || !data) {
    return <p className="p-6 text-sm text-muted-foreground">Loading document…</p>;
  }
  return <BlockDocumentEditor initialDocument={data} />;
}
