"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FaIcon,
  LoaderCircle,
  RotateCcw,
  X,
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";

type HistoryItem = {
  id: string;
  action: string;
  summary: string;
  actor_id: string | null;
  reverted_at: string | null;
  created_at: string;
};

type RestoreResult = {
  restored_change: HistoryItem;
  restored: Record<string, number>;
};

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function DatabaseHistory({
  databaseId,
  compact = false,
}: {
  databaseId: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const historyQ = useQuery<HistoryItem[]>({
    queryKey: ["database-history", databaseId],
    queryFn: () =>
      apiFetch<HistoryItem[]>(`/databases/${databaseId}/history?limit=100`),
    enabled: open,
  });

  const invalidateDatabase = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["database-history", databaseId] }),
      qc.invalidateQueries({ queryKey: ["databases"] }),
      qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
      qc.invalidateQueries({ queryKey: ["entities", databaseId] }),
      qc.invalidateQueries({ queryKey: ["entities-search", databaseId] }),
      qc.invalidateQueries({ queryKey: ["layouts", databaseId] }),
      qc.invalidateQueries({ queryKey: ["data-sources", databaseId] }),
    ]);
  };

  const restore = useMutation({
    mutationFn: (changeId: string) =>
      apiFetch<RestoreResult>(
        `/databases/${databaseId}/history/${changeId}/restore`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setConfirmId(null);
      setMessage(`Restored: ${result.restored_change.summary}`);
      await invalidateDatabase();
      window.dispatchEvent(new CustomEvent("vhb:database-restored"));
    },
  });

  const activeCount = useMemo(
    () => (historyQ.data ?? []).filter((item) => !item.reverted_at).length,
    [historyQ.data],
  );

  return (
    <>
      <button
        type="button"
        aria-label="Open database change history"
        title="Change history"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            : "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        }
      >
        <FaIcon name="history" className="size-3.5" />
        {!compact && "History"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[150]">
          <button
            type="button"
            aria-label="Close database history"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/20"
          />
          <aside className="absolute bottom-3 right-3 top-3 flex w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
              <FaIcon name="history" className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Change history</h2>
                <p className="text-[10px] text-muted-foreground">
                  {activeCount} reversible changes · Ctrl/Cmd+Z restores latest
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center rounded hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            </header>
            {message && (
              <div className="flex items-center gap-2 border-b bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                <Check className="size-3" />
                <span className="min-w-0 flex-1 truncate">{message}</span>
                <button type="button" onClick={() => setMessage("")}>
                  <X className="size-3" />
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {historyQ.isLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" /> Loading history…
                </div>
              ) : (historyQ.data ?? []).length === 0 ? (
                <p className="p-8 text-center text-xs text-muted-foreground">
                  No recorded changes yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {(historyQ.data ?? []).map((item) => {
                    const reverted = Boolean(item.reverted_at);
                    const confirming = confirmId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-lg border px-2.5 py-2 ${
                          reverted ? "bg-muted/30 opacity-60" : "bg-background"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                            <FaIcon name="pen" className="size-3" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium leading-4">
                              {item.summary}
                            </p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {relativeTime(item.created_at)} ·{" "}
                              {item.action.replaceAll(".", " ")}
                            </p>
                          </div>
                        </div>
                        {reverted ? (
                          <p className="mt-2 text-right text-[10px] font-medium text-muted-foreground">
                            Restored
                          </p>
                        ) : (
                          <div className="mt-2 flex justify-end gap-1">
                            {confirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmId(null)}
                                className="h-6 rounded px-2 text-[10px] hover:bg-muted"
                              >
                                Cancel
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={restore.isPending}
                              onClick={() =>
                                confirming
                                  ? restore.mutate(item.id)
                                  : setConfirmId(item.id)
                              }
                              className={`flex h-6 items-center gap-1 rounded px-2 text-[10px] font-medium disabled:opacity-50 ${
                                confirming
                                  ? "bg-destructive text-destructive-foreground"
                                  : "border text-foreground hover:bg-muted"
                              }`}
                            >
                              {restore.isPending && confirming ? (
                                <LoaderCircle className="size-2.5 animate-spin" />
                              ) : (
                                <RotateCcw className="size-2.5" />
                              )}
                              {confirming ? "Confirm restore" : "Restore"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
