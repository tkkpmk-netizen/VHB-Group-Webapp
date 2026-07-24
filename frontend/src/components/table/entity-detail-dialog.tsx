"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { BlockDocumentEditor } from "@/components/documents/block-document-editor";
import { CellEditor } from "@/components/table/cell-editor";
import { FaIcon } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { DEFAULT_ICONS, iconForField } from "@/lib/icon-system";
import { formatEntityId } from "@/lib/entity-id";

type Entity = components["schemas"]["EntityOut"];
type Field = components["schemas"]["FieldOut"];
type Document = components["schemas"]["DocumentOut"];

export function EntityDetailDialog({
  databaseId,
  entity,
  fields,
  onClose,
}: {
  databaseId: string;
  entity: Entity;
  fields: Field[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState(entity);
  const [name, setName] = useState(entity.name);
  const [openDocument, setOpenDocument] = useState<Document | null>(null);
  const entityDocumentsQ = useQuery<Document[]>({
    queryKey: ["entity-documents", entity.id],
    queryFn: () =>
      apiFetch<Document[]>(`/documents?source_entity_id=${entity.id}&limit=10`),
  });
  const linkedDocument = entityDocumentsQ.data?.[0] ?? null;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openDocument) setOpenDocument(null);
      else onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [openDocument, onClose]);

  const update = useMutation({
    mutationFn: (body: { data?: Record<string, unknown>; name?: string }) =>
      apiFetch<Entity>(`/entities/${entity.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (updated) => {
      setCurrent(updated);
      setName(updated.name);
      queryClient.invalidateQueries({ queryKey: ["entities", databaseId] });
      queryClient.invalidateQueries({ queryKey: ["entities-search", databaseId] });
    },
  });

  const createDocument = useMutation({
    mutationFn: () =>
      apiFetch<Document>("/documents", {
        method: "POST",
        body: JSON.stringify({
          title: current.name,
          icon: DEFAULT_ICONS.document,
          source_entity_id: current.id,
        }),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<Document[]>(["entity-documents", entity.id], [created]);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const visibleFields = fields.filter(
    (field) => (field.options as { system_key?: string }).system_key !== "name",
  );
  const [shownFields, setShownFields] = useState(
    () =>
      new Set(
        visibleFields
          .filter(
            (field) =>
              (field.options as { entity_doc_visible?: boolean }).entity_doc_visible !== false,
          )
          .map((field) => field.id),
      ),
  );
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-3 sm:p-6">
        <button
          type="button"
          aria-label="Close entity"
          className="absolute inset-0 cursor-default"
          onClick={onClose}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="entity-dialog-title"
          className="vhb-popover-shadow relative z-10 flex max-h-[88dvh] w-full max-w-[900px] flex-col overflow-hidden rounded-xl border bg-card"
        >
          <header className="flex min-h-12 items-center gap-3 border-b px-4 sm:px-5">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              Entity / {formatEntityId(current, fields.find((field) => field.type === "unique_id"))}
            </p>
            <button
              type="button"
              disabled={createDocument.isPending || entityDocumentsQ.isLoading}
              onClick={() =>
                linkedDocument
                  ? setOpenDocument(linkedDocument)
                  : createDocument.mutate()
              }
              className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <FaIcon name="file-medical" className="size-3.5" />
              {createDocument.isPending
                ? "Creating…"
                : linkedDocument
                  ? "Open Doc"
                  : "Create Doc"}
            </button>
            <button
              type="button"
              aria-label="Close entity"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FaIcon name="times" className="size-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-8 sm:px-14">
            <span className="flex size-10 items-center justify-center rounded-lg bg-[var(--surface-selected)] text-[var(--icon-database)]">
              <FaIcon name={DEFAULT_ICONS.entity} className="size-5" />
            </span>
            <input
              id="entity-dialog-title"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                const next = name.trim();
                if (next && next !== current.name) update.mutate({ name: next });
                else setName(current.name);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="mb-5 mt-4 w-full bg-transparent text-3xl font-bold tracking-[-0.04em] text-[#102447] outline-none"
            />
            <div className="relative mb-2">
              <button
                type="button"
                onClick={() => setPropertyMenuOpen((open) => !open)}
                className="flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <FaIcon name="sliders-h" className="size-3.5" />
                Fields · {shownFields.size}/{visibleFields.length}
              </button>
              {propertyMenuOpen ? (
                <div className="vhb-popover-shadow absolute left-0 top-9 z-20 w-72 rounded-lg border bg-popover p-2">
                  {visibleFields.map((field) => {
                    const shown = shownFields.has(field.id);
                    return (
                      <button
                        key={field.id}
                        type="button"
                        onClick={() => {
                          const next = new Set(shownFields);
                          if (shown) next.delete(field.id);
                          else next.add(field.id);
                          setShownFields(next);
                          void apiFetch<Field>(`/fields/${field.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({
                              options: {
                                ...field.options,
                                entity_doc_visible: !shown,
                              },
                            }),
                          }).then(() =>
                            queryClient.invalidateQueries({
                              queryKey: ["fields", databaseId],
                            }),
                          );
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-muted"
                      >
                        <FaIcon name={iconForField(field)} className="size-3.5" style={{ color: field.icon_color || "var(--icon-field-text)" }} />
                        <span className="min-w-0 flex-1 truncate text-left">{field.name}</span>
                        <FaIcon name={shown ? "eye" : "eye-slash"} className="size-3.5 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <div className="overflow-hidden border-y py-1">
              {visibleFields.filter((field) => shownFields.has(field.id)).map((field) => (
                <div
                  key={field.id}
                  className="grid min-h-10 grid-cols-[minmax(130px,210px)_minmax(0,1fr)] items-center rounded-md hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
                    <FaIcon
                      name={iconForField(field)}
                      className="size-3.5"
                      style={{ color: field.icon_color || "var(--icon-field-text)" }}
                    />
                    <span className="truncate" title={field.name}>{field.name}</span>
                  </div>
                  <div className="min-w-0 px-1 py-1">
                    {field.type === "unique_id" ? (
                      <span className="px-2 text-sm text-muted-foreground">{formatEntityId(current, field)}</span>
                    ) : (
                      <CellEditor
                        field={field}
                        value={(current.data as Record<string, unknown>)[field.id]}
                        databaseId={databaseId}
                        entityId={current.id}
                        onCommit={(value) =>
                          update.mutate({ data: { [field.id]: value } })
                        }
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {update.isError ? (
              <p role="alert" className="mt-3 text-xs text-destructive">
                The entity could not be updated. Please retry.
              </p>
            ) : null}
            {linkedDocument ? (
              <section className="mt-8 border-t pt-4">
                <div className="mb-2 flex h-8 items-center gap-2">
                  <FaIcon
                    name={linkedDocument.icon || DEFAULT_ICONS.document}
                    className="size-3.5 text-primary"
                  />
                  <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">
                    Document
                  </h3>
                  <button
                    type="button"
                    onClick={() => setOpenDocument(linkedDocument)}
                    className="flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <FaIcon name="window-maximize.1" className="size-3" />
                    Expand
                  </button>
                </div>
                <div className="min-h-56 rounded-lg border bg-white px-4 py-2">
                  <BlockDocumentEditor
                    key={linkedDocument.id}
                    initialDocument={linkedDocument}
                    embedded
                  />
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </div>

      {openDocument ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-2 sm:p-5">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`Document for ${current.name}`}
            className="relative flex h-full max-h-[94dvh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl"
          >
            <button
              type="button"
              aria-label="Close document window"
              title="Close document"
              onClick={() => setOpenDocument(null)}
              className="absolute right-2 top-2 z-20 flex size-8 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FaIcon name="times" className="size-4" />
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <BlockDocumentEditor
                initialDocument={openDocument}
                entityMetadata={{ entity: current, fields, databaseId }}
              />
            </div>
          </section>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
