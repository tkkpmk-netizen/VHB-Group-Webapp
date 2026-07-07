"use client";

import { Download, FileSpreadsheet, LoaderCircle, Upload, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

type AssetUpload = {
  asset: { id: string };
  upload_url: string;
};
type Job = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  result: Record<string, unknown> | null;
  error: string | null;
};
type TransferResult = { job: Job };

export function DatabaseTransfers({ databaseId }: { databaseId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [queuedTooLong, setQueuedTooLong] = useState(false);
  const { data: job } = useQuery<Job>({
    queryKey: ["transfer-job", jobId],
    queryFn: () => apiFetch<Job>(`/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    },
  });

  useEffect(() => {
    if (!jobId || job?.status !== "queued") return;
    const timer = window.setTimeout(() => setQueuedTooLong(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [jobId, job?.status]);

  async function importFile(file: File) {
    setBusy(true);
    setMessage("Uploading file…");
    try {
      const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
      const contentType =
        file.type ||
        (format === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const upload = await apiFetch<AssetUpload>("/assets/uploads", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          content_type: contentType,
          size_bytes: file.size,
        }),
      });
      await fetch(upload.upload_url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      await apiFetch(`/assets/${upload.asset.id}/complete`, { method: "POST" });
      const transfer = await apiFetch<TransferResult>(
        `/databases/${databaseId}/imports`,
        {
          method: "POST",
          body: JSON.stringify({
            asset_id: upload.asset.id,
            format,
            create_missing_fields: true,
          }),
        },
      );
      setQueuedTooLong(false);
      setJobId(transfer.job.id);
      setMessage("Import queued");
    } catch {
      setMessage("Import failed before queueing");
    } finally {
      setBusy(false);
    }
  }

  async function exportFile(format: "csv" | "xlsx") {
    setBusy(true);
    setMessage("Preparing export…");
    try {
      const transfer = await apiFetch<TransferResult>(
        `/databases/${databaseId}/exports`,
        { method: "POST", body: JSON.stringify({ format }) },
      );
      setQueuedTooLong(false);
      setJobId(transfer.job.id);
      setMessage("Export queued");
    } catch {
      setMessage("Could not queue export");
    } finally {
      setBusy(false);
    }
  }

  async function downloadResult() {
    const assetId = job?.result?.asset_id;
    if (typeof assetId !== "string") return;
    const result = await apiFetch<{ download_url: string }>(
      `/assets/${assetId}/download`,
    );
    const anchor = document.createElement("a");
    anchor.href = result.download_url;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <FileSpreadsheet className="size-3.5" /> Import / Export
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/25 p-4 pt-[12vh]">
          <button
            type="button"
            aria-label="Close transfer dialog"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <section className="relative z-10 w-full max-w-lg rounded-xl border bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Import / Export database</h2>
                <p className="text-xs text-muted-foreground">
                  CSV and XLSX run safely as durable background jobs.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </button>
            </header>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="flex cursor-pointer flex-col items-center rounded-lg border border-dashed p-6 text-center hover:bg-muted/40">
                <Upload className="mb-2 size-5 text-primary" />
                <span className="text-sm font-medium">Import CSV/XLSX</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  First row becomes field names
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </label>
              <div className="rounded-lg border p-4">
                <Download className="mb-2 size-5 text-emerald-600" />
                <p className="text-sm font-medium">Export current database</p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => exportFile("csv")}
                    className="rounded-md border px-3 py-2 text-xs hover:bg-muted"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportFile("xlsx")}
                    className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-white"
                  >
                    Excel
                  </button>
                </div>
              </div>
            </div>
            {(message || job) && (
              <div className="flex items-center gap-2 border-t px-5 py-3 text-xs">
                {(busy || job?.status === "queued" || job?.status === "running") && (
                  <LoaderCircle className="size-3.5 animate-spin" />
                )}
                <span className="min-w-0 flex-1">
                  {job
                    ? `${job.status}${job.error ? ` · ${job.error}` : ""}${
                        job.status === "queued" && queuedTooLong
                          ? " · Background processing is taking longer than expected"
                          : ""
                      }`
                    : message}
                </span>
                {job?.status === "succeeded" &&
                  typeof job.result?.asset_id === "string" && (
                    <button
                      type="button"
                      onClick={downloadResult}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white"
                    >
                      Download
                    </button>
                  )}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
