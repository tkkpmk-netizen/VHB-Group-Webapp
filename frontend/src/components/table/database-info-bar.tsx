"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { FaIcon, LoaderCircle, X } from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { formatEntityId } from "@/lib/entity-id";
import { iconForField } from "@/lib/icon-system";
import { displayText } from "@/lib/view";

type Entity = components["schemas"]["EntityOut"];
type Field = components["schemas"]["FieldOut"];

type HistoryItem = {
  id: string;
  action: string;
  summary: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  field_changes: Array<{
    field_id: string;
    field_name: string;
    before_value: unknown;
    after_value: unknown;
  }>;
  reverted_at: string | null;
  created_at: string;
};

function exactTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function auditValue(field: Field | undefined, value: unknown) {
  if (value === null || value === undefined || value === "") return "Empty";
  if (field) {
    const displayed = displayText(field, value);
    if (displayed) return displayed;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function propertyValue(entity: Entity, field: Field) {
  const options = field.options as { system_key?: string };
  if (options.system_key === "name") {
    return (
      displayText(field, (entity.data as Record<string, unknown>)[field.id]) ||
      entity.name
    );
  }
  if (field.type === "unique_id") return formatEntityId(entity, field);

  const raw = (entity.data as Record<string, unknown>)[field.id];
  const displayed = displayText(field, raw);
  if (displayed) return displayed;
  if (raw && typeof raw === "object") return JSON.stringify(raw);
  return "Empty";
}

function InfoBarContent({
  databaseId,
  fields,
  entity,
  onCloseMobile,
}: {
  databaseId: string;
  fields: Field[];
  entity: Entity | null;
  onCloseMobile: () => void;
}) {
  const historyQ = useQuery<HistoryItem[]>({
    queryKey: ["database-history", databaseId, entity?.id ?? null],
    queryFn: () =>
      apiFetch<HistoryItem[]>(
        `/databases/${databaseId}/history?limit=100&entity_id=${entity!.id}`,
      ),
    enabled: Boolean(entity),
    // The panel stays mounted while mutations happen elsewhere in the work area.
    // Poll lightly so newly recorded changes appear without reopening the panel.
    refetchInterval: 3_000,
  });

  return (
    <>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FaIcon name="info-circle" className="size-3.5 text-primary" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-[#102447]">
          Record information
        </h2>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close information panel"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground xl:hidden"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-[3] flex-col border-b">
          <div className="shrink-0 px-3 pb-2 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Properties · {fields.length}
            </p>
            {entity ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--surface-selected)] text-[var(--icon-database)]">
                  <FaIcon name="box" className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#102447]">
                    {entity.name || "Untitled"}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    ID {entity.uid || entity.id}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                Select a row to inspect the properties available in the current
                view.
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {entity ? (
              <div className="overflow-hidden rounded-lg border bg-background">
                {fields.map((field) => {
                  const value = propertyValue(entity, field);
                  const empty = value === "Empty";
                  return (
                    <div
                      key={field.id}
                      className="border-b px-2.5 py-2 last:border-b-0 hover:bg-muted/35"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                        <FaIcon
                          name={iconForField(field)}
                          className="size-3"
                          style={{
                            color: field.icon_color || "var(--icon-field-text)",
                          }}
                        />
                        <span className="truncate" title={field.name}>
                          {field.name}
                        </span>
                      </div>
                      <p
                        className={`mt-1 break-words text-[11px] leading-4 ${
                          empty ? "italic text-muted-foreground/70" : "text-foreground"
                        }`}
                      >
                        {value}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </section>

        <section className="flex min-h-40 flex-[2] flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
            <FaIcon name="history" className="size-3 text-primary" />
            <h3 className="text-[11px] font-semibold text-[#102447]">
              Audit history
            </h3>
            <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
              {historyQ.data?.length ?? 0}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!entity ? (
              <p className="p-5 text-center text-[11px] leading-4 text-muted-foreground">
                Select an item to see its audit history.
              </p>
            ) : historyQ.isLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-[11px] text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" /> Loading history…
              </div>
            ) : historyQ.isError ? (
              <button
                type="button"
                onClick={() => void historyQ.refetch()}
                className="w-full rounded-md border border-dashed p-4 text-[11px] text-muted-foreground hover:bg-muted"
              >
                Could not load history. Click to retry.
              </button>
            ) : (historyQ.data ?? []).length === 0 ? (
              <p className="p-5 text-center text-[11px] leading-4 text-muted-foreground">
                No recorded changes yet.
              </p>
            ) : (
              <div className="space-y-1">
                {(historyQ.data ?? []).map((item) => {
                  const visibleChanges = item.field_changes.filter((change) =>
                    fields.some((field) => field.id === change.field_id),
                  );
                  return (
                  <div
                    key={item.id}
                    className={`rounded-md border px-2 py-1.5 ${
                      item.reverted_at ? "bg-muted/30 opacity-60" : "bg-background"
                    }`}
                  >
                    <p className="text-[11px] font-medium leading-4">
                      {item.summary}
                    </p>
                    {visibleChanges.length > 0 ? (
                      <div className="mt-1.5 space-y-1 border-l-2 border-primary/20 pl-2">
                        {visibleChanges.map((change) => {
                          const field = fields.find(
                            (candidate) => candidate.id === change.field_id,
                          );
                          return (
                            <p key={change.field_id} className="text-[10px] leading-4">
                              <span className="font-medium">{change.field_name}:</span>{" "}
                              <span className="text-muted-foreground line-through">
                                {auditValue(field, change.before_value)}
                              </span>{" "}
                              <span aria-hidden="true">→</span>{" "}
                              <span>{auditValue(field, change.after_value)}</span>
                            </p>
                          );
                        })}
                      </div>
                    ) : null}
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {exactTime(item.created_at)} · {relativeTime(item.created_at)} ·{" "}
                      {item.actor_name || item.actor_email || "System"}
                    </p>
                    <p className="mt-0.5 text-[9px] text-muted-foreground">
                      {item.action.replaceAll(".", " ")}
                      {item.reverted_at ? " · restored" : ""}
                    </p>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export function DatabaseInfoBar({
  databaseId,
  fields,
  entity,
  desktopOpen,
  mobileOpen,
  onClose,
}: {
  databaseId: string;
  fields: Field[];
  entity: Entity | null;
  desktopOpen: boolean;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(326);
  const resizingRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const resizing = resizingRef.current;
      if (!resizing) return;
      setWidth(
        Math.min(
          520,
          Math.max(280, resizing.startWidth + resizing.startX - event.clientX),
        ),
      );
    };
    const onUp = () => {
      resizingRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close information panel"
          onClick={onClose}
          className="fixed inset-0 z-[89] bg-black/20 xl:hidden"
        />
      ) : null}
      <aside
        aria-label="Record information and audit history"
        style={{ "--info-bar-width": `${width}px` } as React.CSSProperties}
        className={`fixed bottom-2 right-2 top-2 z-[90] w-[min(var(--info-bar-width),calc(100vw-16px))] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl xl:static xl:z-auto xl:w-[var(--info-bar-width)] xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-r-0 xl:shadow-none ${
          mobileOpen ? "flex" : "hidden"
        } ${desktopOpen ? "xl:flex" : "xl:hidden"}`}
      >
        <button
          type="button"
          aria-label="Resize information panel"
          title="Drag to resize"
          onMouseDown={(event) => {
            event.preventDefault();
            resizingRef.current = { startX: event.clientX, startWidth: width };
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setWidth((current) => Math.min(520, current + 24));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setWidth((current) => Math.max(280, current - 24));
            }
          }}
          className="absolute bottom-0 left-0 top-0 z-10 hidden w-1 -translate-x-1/2 cursor-col-resize bg-transparent hover:bg-primary/25 xl:block"
        />
        <InfoBarContent
          databaseId={databaseId}
          fields={fields}
          entity={entity}
          onCloseMobile={onClose}
        />
      </aside>
    </>
  );
}
