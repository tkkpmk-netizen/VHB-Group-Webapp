"use client";

import {
  BarChart3,
  GripVertical,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResourceAccess } from "@/components/access/resource-access";
import { Dropdown } from "@/components/ui/dropdown";
import { apiFetch } from "@/lib/api/client";

type Dashboard = {
  id: string;
  name: string;
  description: string | null;
};
type Database = { id: string; name: string };
type Field = { id: string; name: string; type: string };
type WidgetType = "metric" | "bar" | "table";
type Widget = {
  id: string;
  dashboard_id: string;
  database_id: string;
  title: string;
  type: WidgetType;
  query: {
    group_by?: string;
    aggregations?: { field_id: string; function: string }[];
  };
  order: number;
};
type RowPage = {
  items: { id: string; data: Record<string, unknown> }[];
  total: number;
  aggregates: Record<string, number | null>;
  groups: {
    key: unknown;
    aggregates: Record<string, number | null>;
  }[];
};

function WidgetCard({
  widget,
  onDelete,
}: {
  widget: Widget;
  onDelete: () => void;
}) {
  const { data, isLoading, isError } = useQuery<{ data: RowPage }>({
    queryKey: ["widget-data", widget.id],
    queryFn: () =>
      apiFetch<{ data: RowPage }>(`/dashboard-widgets/${widget.id}/data`),
    refetchInterval: 30_000,
  });
  const { data: fields = [] } = useQuery<Field[]>({
    queryKey: ["fields", widget.database_id],
    queryFn: () =>
      apiFetch<Field[]>(`/databases/${widget.database_id}/fields`),
    enabled: widget.type === "table",
  });
  const aggregation = widget.query.aggregations?.[0];
  const key = aggregation
    ? `${aggregation.function}:${aggregation.field_id}`
    : "";
  const groups = data?.data.groups ?? [];
  const max = Math.max(
    1,
    ...groups.map((group) => Number(group.aggregates[key] ?? 0)),
  );
  const tableFields = fields.slice(0, 4);

  return (
    <article
      className={`group rounded-xl border bg-card ${
        widget.type === "metric" ? "" : "sm:col-span-2"
      }`}
    >
      <header className="flex h-11 items-center gap-2 border-b px-3">
        <GripVertical className="size-4 text-muted-foreground/50" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {widget.title}
        </h2>
        <button
          type="button"
          aria-label={`Delete ${widget.title}`}
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </header>
      <div className="min-h-36 p-4">
        {isLoading && (
          <LoaderCircle className="mx-auto mt-8 size-5 animate-spin text-muted-foreground" />
        )}
        {isError && (
          <p className="py-8 text-center text-xs text-destructive">
            Could not load widget data.
          </p>
        )}
        {data && widget.type === "metric" && (
          <>
            <p className="text-3xl font-semibold tracking-tight">
              {Number(data.data.aggregates[key] ?? data.data.total).toLocaleString()}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.data.total.toLocaleString()} matching rows
            </p>
          </>
        )}
        {data && widget.type === "bar" && (
          <div className="space-y-3">
            {groups.map((group) => {
              const value = Number(group.aggregates[key] ?? 0);
              return (
                <div key={String(group.key)}>
                  <div className="mb-1 flex justify-between gap-3 text-xs">
                    <span className="truncate">{String(group.key ?? "Empty")}</span>
                    <span className="font-medium">{value.toLocaleString()}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#1264d7]"
                      style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!groups.length && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No grouped data.
              </p>
            )}
          </div>
        )}
        {data && widget.type === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  {tableFields.map((field) => (
                    <th key={field.id} className="px-2 py-2 font-medium">
                      {field.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    {tableFields.map((field) => (
                      <td key={field.id} className="max-w-40 truncate px-2 py-2">
                        {String(row.data[field.id] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </article>
  );
}

function AddWidgetDialog({
  dashboardId,
  onClose,
  onCreated,
}: {
  dashboardId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("New metric");
  const [type, setType] = useState<WidgetType>("metric");
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [valueField, setValueField] = useState<string>("seq");
  const [aggregation, setAggregation] = useState("count");
  const { data: databases = [] } = useQuery<Database[]>({
    queryKey: ["databases"],
    queryFn: () => apiFetch<Database[]>("/databases"),
  });
  const { data: fields = [] } = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
    enabled: Boolean(databaseId),
  });
  const createWidget = useMutation({
    mutationFn: () =>
      apiFetch(`/dashboards/${dashboardId}/widgets`, {
        method: "POST",
        body: JSON.stringify({
          database_id: databaseId,
          title,
          type,
          query: {
            page: 1,
            page_size: type === "table" ? 10 : 1,
            ...(type === "bar" ? { group_by: groupBy } : {}),
            aggregations:
              type === "table"
                ? []
                : [{ field_id: valueField, function: aggregation }],
          },
        }),
      }),
    onSuccess: onCreated,
  });
  const fieldOptions = fields.map((field) => ({
    value: field.id,
    label: field.name,
  }));
  const valueOptions = [
    { value: "seq", label: "Rows" },
    ...fieldOptions,
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/25 p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close widget dialog"
        className="absolute inset-0"
        onClick={onClose}
      />
      <section className="relative z-10 w-full max-w-lg rounded-xl border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="font-semibold">Add widget</h2>
            <p className="text-xs text-muted-foreground">
              Bind a visualization to a database query.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="grid gap-4 p-5">
          <label className="grid gap-1.5 text-xs font-medium">
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-9 rounded-md border px-3 text-sm outline-none focus:border-blue-400"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["metric", LayoutGrid, "Metric"],
                ["bar", BarChart3, "Bar"],
                ["table", Table2, "Table"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm ${
                  type === value ? "border-blue-500 bg-blue-50 text-blue-700" : ""
                }`}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <div className="grid gap-1.5 text-xs font-medium">
            Database
            <div className="rounded-md border">
              <Dropdown
                value={databaseId}
                allowClear={false}
                placeholder="Select database"
                options={databases.map((database) => ({
                  value: database.id,
                  label: database.name,
                }))}
                onChange={(value) => {
                  setDatabaseId(value);
                  setGroupBy(null);
                  setValueField("seq");
                }}
              />
            </div>
          </div>
          {type === "bar" && (
            <div className="grid gap-1.5 text-xs font-medium">
              Group by
              <div className="rounded-md border">
                <Dropdown
                  value={groupBy}
                  allowClear={false}
                  placeholder="Select category field"
                  options={fieldOptions}
                  onChange={setGroupBy}
                />
              </div>
            </div>
          )}
          {type !== "table" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5 text-xs font-medium">
                Value
                <div className="rounded-md border">
                  <Dropdown
                    value={valueField}
                    allowClear={false}
                    options={valueOptions}
                    onChange={(value) => setValueField(value ?? "seq")}
                  />
                </div>
              </div>
              <div className="grid gap-1.5 text-xs font-medium">
                Calculation
                <div className="rounded-md border">
                  <Dropdown
                    value={aggregation}
                    allowClear={false}
                    options={["count", "sum", "avg", "min", "max"].map(
                      (value) => ({ value, label: value.toUpperCase() }),
                    )}
                    onChange={(value) => setAggregation(value ?? "count")}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              !databaseId ||
              !title.trim() ||
              (type === "bar" && !groupBy) ||
              createWidget.isPending
            }
            onClick={() => createWidget.mutate()}
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add widget
          </button>
        </footer>
      </section>
    </div>
  );
}

export function DashboardDesigner({ dashboardId }: { dashboardId: string }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: dashboard, isLoading } = useQuery<Dashboard>({
    queryKey: ["dashboard", dashboardId],
    queryFn: () => apiFetch<Dashboard>(`/dashboards/${dashboardId}`),
  });
  const { data: widgets = [] } = useQuery<Widget[]>({
    queryKey: ["dashboard-widgets", dashboardId],
    queryFn: () =>
      apiFetch<Widget[]>(`/dashboards/${dashboardId}/widgets`),
  });
  const deleteWidget = useMutation({
    mutationFn: (widgetId: string) =>
      apiFetch(`/dashboard-widgets/${widgetId}`, { method: "DELETE" }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["dashboard-widgets", dashboardId],
      }),
  });
  const ordered = useMemo(
    () => [...widgets].sort((a, b) => a.order - b.order),
    [widgets],
  );

  if (isLoading || !dashboard) {
    return <p className="p-6 text-sm text-muted-foreground">Loading dashboard…</p>;
  }
  return (
    <div className="min-h-full bg-[#fafbfc]">
      <header className="flex min-h-14 items-center gap-3 border-b bg-background px-5 py-2">
        <div className="min-w-0">
          <input
            defaultValue={dashboard.name}
            aria-label="Dashboard name"
            onBlur={(event) => {
              const name = event.target.value.trim();
              if (name && name !== dashboard.name) {
                void apiFetch(`/dashboards/${dashboardId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ name }),
                }).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: ["dashboard", dashboardId],
                  }),
                );
              }
            }}
            className="block w-full truncate bg-transparent text-base font-semibold outline-none"
          />
          <input
            defaultValue={dashboard.description ?? ""}
            aria-label="Dashboard description"
            placeholder="Add description"
            onBlur={(event) => {
              const description = event.target.value.trim() || null;
              if (description !== dashboard.description) {
                void apiFetch(`/dashboards/${dashboardId}`, {
                  method: "PATCH",
                  body: JSON.stringify({ description }),
                }).then(() =>
                  queryClient.invalidateQueries({
                    queryKey: ["dashboard", dashboardId],
                  }),
                );
              }
            }}
            className="block w-full truncate bg-transparent text-xs text-muted-foreground outline-none"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ResourceAccess
            resourceType="dashboard"
            resourceId={dashboardId}
            resourceLabel="Dashboard"
          />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-white"
          >
            <Plus className="size-3.5" /> Add widget
          </button>
        </div>
      </header>
      <main className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        {ordered.map((widget) => (
          <WidgetCard
            key={widget.id}
            widget={widget}
            onDelete={() => deleteWidget.mutate(widget.id)}
          />
        ))}
        {!ordered.length && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="col-span-full rounded-xl border border-dashed bg-background p-20 text-sm text-muted-foreground hover:bg-muted/30"
          >
            <Plus className="mx-auto mb-2 size-5" />
            Add your first widget
          </button>
        )}
      </main>
      {adding && (
        <AddWidgetDialog
          dashboardId={dashboardId}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            queryClient.invalidateQueries({
              queryKey: ["dashboard-widgets", dashboardId],
            });
          }}
        />
      )}
    </div>
  );
}
