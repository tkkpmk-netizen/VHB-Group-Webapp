"use client";

import { Download, FileSpreadsheet, LoaderCircle, Upload, X } from "@/components/ui/fa-icon";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import type { components } from "@/lib/api/schema";

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
type Field = components["schemas"]["FieldOut"];
type ImportPreview = {
  columns: { header: string; inferred_type: string; samples: unknown[] }[];
  rows: unknown[][];
  entity_count: number;
  duplicate_names: Record<string, number[]>;
  existing_name_matches: string[];
};

export function DatabaseTransfers({
  databaseId,
  compact = false,
}: {
  databaseId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [queuedTooLong, setQueuedTooLong] = useState(false);
  const [dataSourceName, setDataSourceName] = useState("");
  const [pendingImport, setPendingImport] = useState<{ assetId: string; format: "csv" | "xlsx" } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [nameColumn, setNameColumn] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [fieldTypes, setFieldTypes] = useState<Record<string, string>>({});
  const [includedRows, setIncludedRows] = useState<Set<number>>(new Set());
  const [incomingPolicy, setIncomingPolicy] = useState<"skip" | "suffix">("suffix");
  const [existingPolicy, setExistingPolicy] = useState<"update" | "suffix">("suffix");
  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
  });
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
      const review = await apiFetch<ImportPreview>(
        `/databases/${databaseId}/imports/preview`,
        {
          method: "POST",
          body: JSON.stringify({ asset_id: upload.asset.id, format, name_column: "" }),
        },
      );
      const fields = fieldsQ.data ?? [];
      const suggestedName = review.columns.find((column) => column.header.toLowerCase() === "name")?.header ?? review.columns[0]?.header ?? null;
      setPendingImport({ assetId: upload.asset.id, format });
      setPreview(review);
      setNameColumn(suggestedName);
      setMapping(
        Object.fromEntries(
          review.columns.map((column) => [
            column.header,
            fields.find((field) => field.name.toLowerCase() === column.header.toLowerCase())?.id ?? null,
          ]),
        ),
      );
      setFieldTypes(Object.fromEntries(review.columns.map((column) => [column.header, column.inferred_type])));
      setIncludedRows(new Set(review.rows.map((_, index) => index)));
      setMessage("Review column mapping before importing");
    } catch {
      setMessage("Import failed before queueing");
    } finally {
      setBusy(false);
    }
  }

  async function queueReviewedImport() {
    if (!pendingImport || !preview || !nameColumn) return;
    setBusy(true);
    try {
      const transfer = await apiFetch<TransferResult>(`/databases/${databaseId}/imports`, {
        method: "POST",
        body: JSON.stringify({
          asset_id: pendingImport.assetId,
          format: pendingImport.format,
          mapping: Object.fromEntries(
            Object.entries(mapping).filter(([, fieldId]) => Boolean(fieldId)),
          ),
          field_types: fieldTypes,
          name_column: nameColumn,
          include_rows: includedRows.size === preview.rows.length ? undefined : [...includedRows],
          incoming_duplicate_policy: incomingPolicy,
          existing_name_policy: existingPolicy,
          create_missing_fields: true,
          data_source_name: dataSourceName.trim() || undefined,
        }),
      });
      setQueuedTooLong(false);
      setJobId(transfer.job.id);
      setPreview(null);
      setPendingImport(null);
      setMessage("Import queued");
    } catch {
      setMessage("Could not queue import");
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
        aria-label="Import or export database"
        title="Import / Export database"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            : "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        }
      >
        <FileSpreadsheet className="size-3.5" /> {!compact && "Import / Export"}
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
              <div className="rounded-lg border border-dashed p-6 text-center hover:bg-muted/40">
                <label className="flex cursor-pointer flex-col items-center">
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
                <input
                  value={dataSourceName}
                  onChange={(e) => setDataSourceName(e.target.value)}
                  placeholder="Data source name (optional)"
                  disabled={busy}
                  className="mt-3 w-full rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
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
            {preview && (
              <div className="max-h-[58vh] space-y-4 overflow-y-auto border-t p-5">
                <div>
                  <h3 className="font-medium">Map imported columns</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    UID is generated automatically. Choose the required Name column, then map the remaining columns.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Required Name column
                    <Dropdown
                      value={nameColumn}
                      allowClear={false}
                      options={preview.columns.map((column) => ({ value: column.header, label: column.header }))}
                      onChange={setNameColumn}
                    />
                  </label>
                  {preview.columns.map((column) => (
                    <div key={column.header} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] gap-2">
                      <div className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                        <span className="block truncate font-medium">{column.header}</span>
                        <span className="text-muted-foreground">{column.inferred_type}</span>
                      </div>
                      <Dropdown
                        value={mapping[column.header] ?? null}
                        placeholder="Create matching field"
                        options={fieldsQ.data?.filter((field) => field.type !== "unique_id").map((field) => ({ value: field.id, label: `${field.name} · ${field.type}` })) ?? []}
                        onChange={(fieldId) => setMapping((current) => ({ ...current, [column.header]: fieldId }))}
                      />
                      <Dropdown
                        value={fieldTypes[column.header] ?? column.inferred_type}
                        allowClear={false}
                        options={[
                          { value: "text", label: "Text" },
                          { value: "long_text", label: "Long text" },
                          { value: "number", label: "Number" },
                          { value: "date", label: "Date" },
                          { value: "checkbox", label: "Checkbox" },
                          { value: "email", label: "Email" },
                          { value: "url", label: "URL" },
                          { value: "phone", label: "Phone" },
                        ]}
                        onChange={(value) => value && setFieldTypes((current) => ({ ...current, [column.header]: value }))}
                      />
                    </div>
                  ))}
                </div>

                {(Object.keys(preview.duplicate_names).length > 0 || preview.existing_name_matches.length > 0) && (
                  <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p className="font-medium">Name conflicts need review</p>
                    {Object.keys(preview.duplicate_names).length > 0 && (
                      <label className="block text-xs">
                        Duplicate names inside file ({Object.keys(preview.duplicate_names).length})
                        <Dropdown
                          value={incomingPolicy}
                          allowClear={false}
                          options={[
                            { value: "suffix", label: "Import all and add numeric suffixes" },
                            { value: "skip", label: "Import only selected unique entities" },
                          ]}
                          onChange={(value) => value && setIncomingPolicy(value as "skip" | "suffix")}
                        />
                      </label>
                    )}
                    {preview.existing_name_matches.length > 0 && (
                      <label className="block text-xs">
                        Matches with existing entities ({preview.existing_name_matches.length})
                        <Dropdown
                          value={existingPolicy}
                          allowClear={false}
                          options={[
                            { value: "suffix", label: "Import as new entities with suffixes" },
                            { value: "update", label: "Bulk update matching existing entities" },
                          ]}
                          onChange={(value) => value && setExistingPolicy(value as "update" | "suffix")}
                        />
                      </label>
                    )}
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Select entities to import ({includedRows.size} of {preview.entity_count})</span>
                    <button
                      type="button"
                      onClick={() => setIncludedRows(new Set(preview.rows.map((_, index) => index)))}
                      className="text-primary hover:underline"
                    >
                      Select all previewed
                    </button>
                  </div>
                  <div className="max-h-40 overflow-auto rounded-md border text-xs">
                    {preview.rows.map((row, index) => (
                      <label key={index} className="flex cursor-pointer items-center gap-2 border-b px-2 py-1.5 last:border-b-0 hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={includedRows.has(index)}
                          onChange={() => setIncludedRows((current) => {
                            const next = new Set(current);
                            if (next.has(index)) next.delete(index); else next.add(index);
                            return next;
                          })}
                          className="size-3.5 accent-[var(--color-primary)]"
                        />
                        <span className="truncate">{row.map((value) => String(value ?? "")).join(" · ")}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPreview(null)} className="rounded-md px-3 py-2 text-sm hover:bg-muted">Cancel</button>
                  <button
                    type="button"
                    disabled={!nameColumn || includedRows.size === 0 || busy}
                    onClick={() => void queueReviewedImport()}
                    className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Import selected entities
                  </button>
                </div>
              </div>
            )}
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
