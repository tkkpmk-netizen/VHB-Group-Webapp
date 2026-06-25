"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { CHIP_COLORS, chipColor, STATUS_GROUPS } from "@/lib/field-colors";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Choice = { id: string; label: string; color?: string; group?: string };
type Options = Record<string, unknown> & { choices?: Choice[] };

const CURRENCIES = ["VND", "USD", "EUR", "JPY", "CNY", "KRW", "GBP"];
const DATE_FORMATS = [
  { id: "iso", label: "2026-12-31" },
  { id: "dmy", label: "31/12/2026" },
  { id: "mdy", label: "12/31/2026" },
  { id: "ymd", label: "2026/12/31" },
];

function ColorPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const c = chipColor(value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="size-5 rounded-full border"
        style={{ backgroundColor: c.bg }}
        title={c.label}
      />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 grid grid-cols-5 gap-1 rounded-lg border bg-popover p-2 shadow-md">
            {CHIP_COLORS.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => {
                  onChange(col.id);
                  setOpen(false);
                }}
                className="flex size-6 items-center justify-center rounded-full border"
                style={{ backgroundColor: col.bg }}
                title={col.label}
              >
                {value === col.id && <Check className="size-3" style={{ color: col.fg }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChoiceRow({
  choice,
  onChange,
  onDelete,
}: {
  choice: Choice;
  onChange: (c: Choice) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ColorPicker
        value={choice.color}
        onChange={(color) => onChange({ ...choice, color })}
      />
      <input
        value={choice.label}
        onChange={(e) => onChange({ ...choice, label: e.target.value })}
        className="flex-1 rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="button"
        onClick={onDelete}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function newChoice(group?: string): Choice {
  return { id: crypto.randomUUID(), label: "New", color: "default", group };
}

export function ColumnMenu({
  field,
  databaseId,
  onClose,
  x,
  y,
}: {
  field: Field;
  databaseId: string;
  onClose: () => void;
  x: number;
  y: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(field.name);
  const [opts, setOpts] = useState<Options>((field.options as Options) ?? {});

  const patch = useMutation({
    mutationFn: (body: { name: string; options: Options }) =>
      apiFetch<Field>(`/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      qc.invalidateQueries({ queryKey: ["rows", databaseId] });
    },
  });

  const del = useMutation({
    mutationFn: () => apiFetch<void>(`/fields/${field.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      onClose();
    },
  });

  function commit(nextOpts: Options, nextName = name) {
    setOpts(nextOpts);
    patch.mutate({ name: nextName.trim() || field.name, options: nextOpts });
  }

  const choices = opts.choices ?? [];
  const isChoice = ["select", "multi_select"].includes(field.type);
  const isStatus = field.type === "status" || field.type === "priority";

  const left =
    typeof window !== "undefined" ? Math.min(x, window.innerWidth - 300) : x;
  return createPortal(
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="fixed z-40 max-h-[80vh] w-72 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
        style={{ top: y, left: Math.max(8, left) }}
      >
        {/* Rename */}
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit(opts)}
          className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="px-1 pb-1 text-xs text-muted-foreground">
          Type: {field.type} · Edit property
        </p>

        <div className="max-h-80 space-y-3 overflow-y-auto px-1 py-2">
          {/* NUMBER */}
          {field.type === "number" && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Number format</label>
              <Dropdown
                value={
                  (opts.format as string) === "plain"
                    ? "integer"
                    : ((opts.format as string) ?? "integer")
                }
                allowClear={false}
                options={[
                  { value: "integer", label: "Số nguyên" },
                  { value: "decimal", label: "Số thập phân" },
                  { value: "percent", label: "Phần trăm" },
                  { value: "currency", label: "Currency" },
                ]}
                onChange={(v) => v && commit({ ...opts, format: v })}
              />
              {opts.format === "decimal" && (
                <label className="flex items-center justify-between text-sm">
                  Decimal places
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={(opts.precision as number) ?? 2}
                    onChange={(e) =>
                      commit({ ...opts, precision: Number(e.target.value) })
                    }
                    className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                  />
                </label>
              )}
              {opts.format === "currency" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">Currency</label>
                  <Dropdown
                    value={(opts.currency_code as string) ?? "VND"}
                    allowClear={false}
                    options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                    onChange={(v) => v && commit({ ...opts, currency_code: v })}
                  />
                </div>
              )}
            </div>
          )}

          {/* UNIQUE ID */}
          {field.type === "unique_id" && (
            <label className="flex items-center justify-between text-sm">
              Prefix
              <input
                value={(opts.prefix as string) ?? ""}
                onChange={(e) => commit({ ...opts, prefix: e.target.value })}
                placeholder="e.g. VHB-"
                className="w-28 rounded-md border bg-background px-2 py-1 text-sm"
              />
            </label>
          )}

          {/* URL */}
          {field.type === "url" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={opts.hyperlink === true}
                onChange={(e) => commit({ ...opts, hyperlink: e.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              Show as hyperlink (click to open)
            </label>
          )}

          {/* DATE */}
          {field.type === "date" && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Date format</label>
              <Dropdown
                value={(opts.date_format as string) ?? "iso"}
                allowClear={false}
                options={DATE_FORMATS.map((d) => ({ value: d.id, label: d.label }))}
                onChange={(v) => v && commit({ ...opts, date_format: v })}
              />
              <p className="text-xs text-muted-foreground">
                Time + timezone + notifications: coming soon.
              </p>
            </div>
          )}

          {/* SELECT / MULTI-SELECT */}
          {isChoice && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Options</label>
              {choices.map((c, i) => (
                <ChoiceRow
                  key={c.id}
                  choice={c}
                  onChange={(nc) => {
                    const next = [...choices];
                    next[i] = nc;
                    commit({ ...opts, choices: next });
                  }}
                  onDelete={() =>
                    commit({ ...opts, choices: choices.filter((_, j) => j !== i) })
                  }
                />
              ))}
              <button
                type="button"
                onClick={() => commit({ ...opts, choices: [...choices, newChoice()] })}
                className="flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Plus className="size-3.5" /> Add option
              </button>
            </div>
          )}

          {/* STATUS / PRIORITY — grouped */}
          {isStatus && (
            <div className="space-y-3">
              {STATUS_GROUPS.map((g) => {
                const groupChoices = choices.filter((c) => c.group === g.id);
                return (
                  <div key={g.id} className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {g.name}
                    </p>
                    {groupChoices.map((c) => {
                      const idx = choices.findIndex((x) => x.id === c.id);
                      return (
                        <ChoiceRow
                          key={c.id}
                          choice={c}
                          onChange={(nc) => {
                            const next = [...choices];
                            next[idx] = nc;
                            commit({ ...opts, choices: next });
                          }}
                          onDelete={() =>
                            commit({
                              ...opts,
                              choices: choices.filter((x) => x.id !== c.id),
                            })
                          }
                        />
                      );
                    })}
                    <button
                      type="button"
                      onClick={() =>
                        commit({ ...opts, choices: [...choices, newChoice(g.id)] })
                      }
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="size-3" /> Add status
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={() => del.mutate()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-4" /> Delete column
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
