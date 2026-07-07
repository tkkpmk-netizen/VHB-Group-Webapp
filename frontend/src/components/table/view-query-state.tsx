"use client";

import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

export function ViewQueryState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (!loading && !error) return null;
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-card/80 backdrop-blur-[1px]">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading view…
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-5 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-2 size-5 text-destructive" />
          <p className="text-sm font-medium">Could not load this view</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            <RefreshCw className="size-3.5" /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
