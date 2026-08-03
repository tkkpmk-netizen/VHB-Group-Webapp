"use client";

import { FileSpreadsheet, LoaderCircle, Upload, X } from "@/components/ui/fa-icon";
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
  columns: {
    header: string;
    inferred_type: string;
    samples: unknown[];
    generated_options: string[];
  }[];
  rows: unknown[][];
  entity_count: number;
  duplicate_names: Record<string, number[]>;
  existing_name_matches: string[];
};

const CREATE_FIELD = "__create__";
const SKIP_COLUMN = "__skip__";
const IMPORT_FIELD_TYPES = [
  ["text", "Text"],
  ["long_text", "Long text"],
  ["number", "Number"],
  ["checkbox", "Checkbox"],
  ["date", "Date"],
  ["url", "URL"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["country", "Country"],
  ["select", "Select"],
  ["multi_select", "Multi-select"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["rating", "Rating"],
  ["people", "People"],
  ["progress", "Progress"],
  ["files", "Files"],
  ["created_time", "Created time (preserve source value)"],
  ["last_edited_time", "Last edited time (preserve source value)"],
  ["created_by", "Created by"],
  ["last_edited_by", "Last edited by"],
] as const;
const IMPORTABLE_TARGET_TYPES = new Set<string>(
  IMPORT_FIELD_TYPES.map(([value]) => value),
);

function isImportableTarget(field: Field) {
  return IMPORTABLE_TARGET_TYPES.has(field.type);
}

function fieldTypeLabel(type: string) {
  return IMPORT_FIELD_TYPES.find(([value]) => value === type)?.[1] ?? type;
}

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
  const [mapping, setMapping] = useState<Record<string, string>>({});
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
            fields.find(
              (field) =>
                isImportableTarget(field) &&
                field.name.toLowerCase() === column.header.toLowerCase(),
            )?.id ?? CREATE_FIELD,
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
      const nameField = fieldsQ.data?.find((field) => field.type === "name");
      const mappedFields = Object.fromEntries(
        Object.entries(mapping).filter(
          ([header, fieldId]) =>
            header !== nameColumn &&
            fieldId !== CREATE_FIELD &&
            fieldId !== SKIP_COLUMN,
        ),
      );
      if (nameField) mappedFields[nameColumn] = nameField.id;
      const transfer = await apiFetch<TransferResult>(`/databases/${databaseId}/imports`, {
        method: "POST",
        body: JSON.stringify({
          asset_id: pendingImport.assetId,
          format: pendingImport.format,
          mapping: mappedFields,
          field_types: Object.fromEntries(
            Object.entries(fieldTypes).filter(
              ([header]) =>
                header !== nameColumn && mapping[header] === CREATE_FIELD,
            ),
          ),
          skipped_columns: Object.entries(mapping)
            .filter(([header, target]) => header !== nameColumn && target === SKIP_COLUMN)
            .map(([header]) => header),
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

  return (
    <>
      <button
        type="button"
        aria-label="Import database"
        title="Import database"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            : "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
        }
      >
        <FileSpreadsheet className="size-3.5" /> {!compact && "Import"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/25 p-4 pt-[12vh]">
          <button
            type="button"
            aria-label="Close transfer dialog"
            className="absolute inset-0"
            onClick={() => setOpen(false)}
          />
          <section className="relative z-10 w-full max-w-3xl rounded-xl border bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <h2 className="font-semibold">Import database</h2>
                <p className="text-xs text-muted-foreground">
                  CSV and XLSX imports run safely as durable background jobs.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </button>
            </header>
            <div className="p-5">
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
                  {preview.columns.map((column) => {
                    const target = mapping[column.header] ?? CREATE_FIELD;
                    const existingField = fieldsQ.data?.find((field) => field.id === target);
                    const isNameColumn = column.header === nameColumn;
                    const selectedType =
                      fieldTypes[column.header] ?? column.inferred_type;
                    const createsOptions = [
                      "select",
                      "multi_select",
                      "status",
                      "priority",
                    ].includes(selectedType);
                    return (
                      <div
                        key={column.header}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(13rem,1fr)_12rem] items-start gap-2 rounded-lg border border-transparent p-1 hover:border-border hover:bg-muted/20"
                      >
                        <div className="min-w-0 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                          <span className="block truncate font-medium">{column.header}</span>
                          <span className="text-muted-foreground">
                            Detected · {fieldTypeLabel(column.inferred_type)}
                          </span>
                        </div>
                        {isNameColumn ? (
                          <div className="flex h-8 items-center rounded-md bg-primary/8 px-2 text-xs font-medium text-primary">
                            Required Name field
                          </div>
                        ) : (
                          <Dropdown
                            value={target}
                            allowClear={false}
                            searchable
                            searchPlaceholder="Search destination fields…"
                            options={[
                              {
                                value: CREATE_FIELD,
                                label: `Create "${column.header}"`,
                              },
                              { value: SKIP_COLUMN, label: "Don’t Import" },
                              ...(fieldsQ.data
                                ?.filter(isImportableTarget)
                                .map((field) => ({
                                  value: field.id,
                                  label: `${field.name} · ${fieldTypeLabel(field.type)}`,
                                })) ?? []),
                            ]}
                            onChange={(fieldId) =>
                              fieldId &&
                              setMapping((current) => ({
                                ...current,
                                [column.header]: fieldId,
                              }))
                            }
                          />
                        )}
                        {isNameColumn ? (
                          <div className="flex h-8 items-center rounded-md bg-muted px-2 text-xs font-medium">
                            Name
                          </div>
                        ) : existingField ? (
                          <div
                            className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-xs font-medium"
                            title="The existing field keeps its current type"
                          >
                            {fieldTypeLabel(existingField.type)}
                          </div>
                        ) : target === SKIP_COLUMN ? (
                          <div className="flex h-8 items-center rounded-md bg-muted/40 px-2 text-xs text-muted-foreground">
                            Not imported
                          </div>
                        ) : (
                          <Dropdown
                            value={selectedType}
                            allowClear={false}
                            searchable
                            searchPlaceholder="Search field types…"
                            options={IMPORT_FIELD_TYPES.map(([value, label]) => ({
                              value,
                              label,
                            }))}
                            onChange={(value) =>
                              value &&
                              setFieldTypes((current) => ({
                                ...current,
                                [column.header]: value,
                              }))
                            }
                          />
                        )}
                        {!isNameColumn &&
                          target === CREATE_FIELD &&
                          createsOptions &&
                          column.generated_options.length > 0 && (
                            <div className="col-start-2 col-span-2 flex flex-wrap gap-1 px-1 pb-1 text-[11px]">
                              <span className="mr-1 text-muted-foreground">
                                Options to create:
                              </span>
                              {column.generated_options.slice(0, 8).map((option) => (
                                <span
                                  key={option}
                                  className="max-w-32 truncate rounded-full bg-primary/10 px-2 py-0.5 text-primary"
                                >
                                  {option}
                                </span>
                              ))}
                              {column.generated_options.length > 8 && (
                                <span className="text-muted-foreground">
                                  +{column.generated_options.length - 8} more
                                </span>
                              )}
                            </div>
                          )}
                      </div>
                    );
                  })}
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
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
