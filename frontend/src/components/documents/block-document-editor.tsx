"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { MantineProvider } from "@mantine/core";
import { Check, Cloud, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
import { ResourceAccess } from "@/components/access/resource-access";
import { apiFetch } from "@/lib/api/client";

type DocumentData = {
  id: string;
  title: string;
  icon: string | null;
  content: Record<string, unknown>[];
  version: number;
};

export function BlockDocumentEditor({
  initialDocument,
}: {
  initialDocument: DocumentData;
}) {
  const version = useRef(initialDocument.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(initialDocument.title);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const editor = useCreateBlockNote({
    initialContent: initialDocument.content as PartialBlock[],
  });

  async function saveContent(blocks: Block[]) {
    setSaveState("saving");
    try {
      const saved = await apiFetch<DocumentData>(
        `/documents/${initialDocument.id}/content`,
        {
          method: "PUT",
          body: JSON.stringify({
            content: blocks,
            expected_version: version.current,
          }),
        },
      );
      version.current = saved.version;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <MantineProvider>
      <div className="flex min-h-full flex-col">
        <header className="flex h-12 items-center gap-3 border-b px-5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() =>
              apiFetch(`/documents/${initialDocument.id}`, {
                method: "PATCH",
                body: JSON.stringify({ title: title.trim() || "Untitled" }),
              })
            }
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
          />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {saveState === "saving" ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : saveState === "saved" ? (
              <Check className="size-3.5 text-emerald-600" />
            ) : (
              <Cloud className="size-3.5 text-destructive" />
            )}
            {saveState}
          </span>
          <ResourceAccess
            resourceType="document"
            resourceId={initialDocument.id}
            resourceLabel="Document"
          />
        </header>
        <div className="mx-auto w-full max-w-4xl flex-1 py-10">
          <BlockNoteView
            editor={editor}
            theme="light"
            onChange={() => {
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(
                () => saveContent(editor.document),
                700,
              );
            }}
          />
        </div>
      </div>
    </MantineProvider>
  );
}
