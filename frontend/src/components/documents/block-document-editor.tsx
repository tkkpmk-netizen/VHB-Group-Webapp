"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { Block, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { MantineProvider } from "@mantine/core";
import { Check, Cloud, Eye, EyeOff, FaIcon, LoaderCircle, SlidersHorizontal } from "@/components/ui/fa-icon";
import { useRef, useState } from "react";
import { ResourceAccess } from "@/components/access/resource-access";
import { IconPicker } from "@/components/ui/icon-picker";
import { apiFetch } from "@/lib/api/client";
import { useCollaboration } from "@/lib/collaboration";
import { CellEditor } from "@/components/table/cell-editor";
import { iconForField } from "@/lib/icon-system";
import { formatEntityId } from "@/lib/entity-id";
import type { components } from "@/lib/api/schema";

type Entity = components["schemas"]["EntityOut"];
type Field = components["schemas"]["FieldOut"];

type DocumentData = {
  id: string;
  title: string;
  icon: string | null;
  icon_color?: string | null;
  content: Record<string, unknown>[];
  version: number;
};

export function BlockDocumentEditor({
  initialDocument,
  entityMetadata,
  embedded = false,
}: {
  initialDocument: DocumentData;
  entityMetadata?: { entity: Entity; fields: Field[]; databaseId: string };
  embedded?: boolean;
}) {
  const version = useRef(initialDocument.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(initialDocument.title);
  const [icon, setIcon] = useState(initialDocument.icon || "file-alt");
  const [iconColor, setIconColor] = useState(initialDocument.icon_color || "#7b68ee");
  const metadataFields = (entityMetadata?.fields ?? []).filter(
    (field) => (field.options as { system_key?: string }).system_key !== "name",
  );
  const [metadataEntity, setMetadataEntity] = useState(entityMetadata?.entity);
  const [visibleMetadata, setVisibleMetadata] = useState(
    () => new Set(metadataFields.map((field) => field.id)),
  );
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const collaboration = useCollaboration({
    resourceType: "document",
    resourceId: initialDocument.id,
  });
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
      <div className={`flex flex-col bg-white ${embedded ? "min-h-52" : "min-h-full"}`}>
        {!embedded ? <header className="sticky top-0 z-10 flex h-11 items-center gap-3 border-b bg-white/95 px-5 backdrop-blur">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Docs / <span className="font-medium text-foreground">{title}</span>
          </span>
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
          <div className="flex items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-xs text-muted-foreground">
            <span
              className={`size-2 rounded-full ${
                collaboration.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
              }`}
            />
            {collaboration.collaborators.length} online
          </div>
          {collaboration.collaborators.slice(0, 4).map((user) => (
            <span
              key={user.session_id}
              title={user.email}
              className="grid size-7 place-items-center rounded-full bg-blue-50 text-[10px] font-semibold text-blue-700"
            >
              {user.name.slice(0, 2).toUpperCase()}
            </span>
          ))}
          <ResourceAccess
            resourceType="document"
            resourceId={initialDocument.id}
            resourceLabel="Document"
          />
        </header> : null}
        <div
          className={
            embedded
              ? "w-full flex-1 px-1 pb-3 pt-1"
              : "mx-auto w-full max-w-4xl flex-1 px-6 pb-16 pt-14 sm:px-12"
          }
        >
          {!embedded ? <IconPicker
            value={icon}
            onChange={(nextIcon) => {
              setIcon(nextIcon);
              void apiFetch(`/documents/${initialDocument.id}`, {
                method: "PATCH",
                body: JSON.stringify({ icon: nextIcon }),
              });
            }}
            onColorChange={(nextColor) => {
              setIconColor(nextColor);
              void apiFetch(`/documents/${initialDocument.id}`, {
                method: "PATCH",
                body: JSON.stringify({ icon_color: nextColor }),
              });
            }}
            label={`Choose icon for ${title}`}
            color={iconColor}
          /> : null}
          {!embedded ? <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() =>
              apiFetch(`/documents/${initialDocument.id}`, {
                method: "PATCH",
                body: JSON.stringify({ title: title.trim() || "Untitled" }),
              })
            }
            className="mb-4 mt-5 block w-full bg-transparent text-4xl font-bold tracking-[-0.04em] text-[#102447] outline-none placeholder:text-muted-foreground"
          /> : null}

          {!embedded && metadataEntity && metadataFields.length ? (
            <section className="relative mb-10 max-w-3xl border-y py-3">
              <button
                type="button"
                onClick={() => setPropertyMenuOpen((open) => !open)}
                className="mb-2 flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
                Fields · {visibleMetadata.size}/{metadataFields.length}
              </button>
              {propertyMenuOpen ? (
                <div className="vhb-popover-shadow absolute left-0 top-11 z-20 w-72 rounded-lg border bg-popover p-2">
                  <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <span>Visible fields</span>
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleMetadata(
                          visibleMetadata.size ? new Set() : new Set(metadataFields.map((field) => field.id)),
                        )
                      }
                      className="normal-case text-primary"
                    >
                      {visibleMetadata.size ? "Hide all" : "Show all"}
                    </button>
                  </div>
                  {metadataFields.map((field) => {
                    const visible = visibleMetadata.has(field.id);
                    return (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => {
                          const next = new Set(visibleMetadata);
                          if (visible) next.delete(field.id);
                          else next.add(field.id);
                          setVisibleMetadata(next);
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
                      >
                        <FaIcon name={iconForField(field)} className="size-3.5" style={{ color: field.icon_color || "var(--icon-field-text)" }} />
                        <span className="min-w-0 flex-1 truncate text-left">{field.name}</span>
                        {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-muted-foreground" />}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="space-y-0.5">
                {metadataFields.filter((field) => visibleMetadata.has(field.id)).map((field) => (
                  <div key={field.id} className="grid min-h-9 grid-cols-[180px_minmax(0,1fr)] items-center rounded-md hover:bg-muted/40">
                    <span className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
                      <FaIcon name={iconForField(field)} className="size-3.5 shrink-0" style={{ color: field.icon_color || "var(--icon-field-text)" }} />
                      <span className="truncate">{field.name}</span>
                    </span>
                    <div className="min-w-0">
                      {field.type === "unique_id" ? (
                        <span className="px-2 text-sm text-muted-foreground">{formatEntityId(metadataEntity, field)}</span>
                      ) : (
                        <CellEditor
                          field={field}
                          value={(metadataEntity.data as Record<string, unknown>)[field.id]}
                          databaseId={entityMetadata?.databaseId}
                          entityId={metadataEntity.id}
                          onCommit={(value) => {
                            void apiFetch<Entity>(`/entities/${metadataEntity.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ data: { [field.id]: value } }),
                            }).then(setMetadataEntity);
                          }}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <BlockNoteView
            editor={editor}
            theme="light"
            onChange={() => {
              collaboration.sendEvent("content.changed", {
                version: version.current,
                block_count: editor.document.length,
              });
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
