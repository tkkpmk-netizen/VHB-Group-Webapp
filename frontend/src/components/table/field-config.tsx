"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { FormulaEditor } from "@/components/table/formula-editor";
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
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const c = chipColor(value);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          if (r) setPos({ x: r.left, y: r.bottom + 4 });
        }}
        className="size-5 shrink-0 rounded-full border"
        style={{ backgroundColor: c.bg }}
        title={c.label}
      />
      {pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
            <div
              className="fixed z-50 grid grid-cols-5 gap-1 rounded-lg border bg-popover p-2 shadow-lg"
              style={{ top: pos.y, left: pos.x }}
            >
              {CHIP_COLORS.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => {
                    onChange(col.id);
                    setPos(null);
                  }}
                  className="flex size-6 items-center justify-center rounded-full border"
                  style={{ backgroundColor: col.bg }}
                  title={col.label}
                >
                  {value === col.id && (
                    <Check className="size-3" style={{ color: col.fg }} />
                  )}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
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
      <ColorPicker value={choice.color} onChange={(color) => onChange({ ...choice, color })} />
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

/** Rename + per-type options editor for a field (shared by column menu + settings). */
export function FieldConfig({
  field,
  databaseId,
}: {
  field: Field;
  databaseId: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(field.name);
  const [opts, setOpts] = useState<Options>((field.options as Options) ?? {});
  const [editingFormula, setEditingFormula] = useState(false);

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

  function commit(nextOpts: Options, nextName = name) {
    setOpts(nextOpts);
    patch.mutate({ name: nextName.trim() || field.name, options: nextOpts });
  }

  const dbFieldsQ = useQuery<Field[]>({
    queryKey: ["fields", databaseId],
    queryFn: () => apiFetch<Field[]>(`/databases/${databaseId}/fields`),
    enabled: field.type === "rollup" || field.type === "formula",
  });
  const relationFields = (dbFieldsQ.data ?? []).filter((f) => f.type === "relation");
  const relField = relationFields.find(
    (f) => f.id === (opts.relation_field_id as string | undefined),
  );
  const rollupTargetDb = (relField?.options as { target_database_id?: string })
    ?.target_database_id;
  const targetFieldsQ = useQuery<Field[]>({
    queryKey: ["fields", rollupTargetDb],
    queryFn: () => apiFetch<Field[]>(`/databases/${rollupTargetDb}/fields`),
    enabled: field.type === "rollup" && !!rollupTargetDb,
  });

  const choices = opts.choices ?? [];
  const isChoice = ["select", "multi_select"].includes(field.type);
  const isStatus = field.type === "status" || field.type === "priority";

  return (
    <>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => commit(opts)}
        className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
      />
      <p className="px-1 pb-1 text-xs text-muted-foreground">Type: {field.type}</p>

      {field.type !== "unique_id" && (
        <label className="flex items-center justify-between px-1 py-1.5 text-sm">
          Wrap text
          <input
            type="checkbox"
            checked={opts.wrap === true}
            onChange={(e) => commit({ ...opts, wrap: e.target.checked })}
            className="size-4 accent-[var(--color-primary)]"
          />
        </label>
      )}

      <div className="space-y-3 px-1 py-2">
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
                { value: "integer", label: "Integer" },
                { value: "decimal", label: "Decimal" },
                { value: "percent", label: "Percent" },
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

        {field.type === "rollup" && (
          <div className="space-y-2">
            <label className="text-xs font-medium">Relation</label>
            <Dropdown
              value={(opts.relation_field_id as string) ?? null}
              placeholder="Pick relation…"
              options={relationFields.map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) =>
                commit({ ...opts, relation_field_id: v, target_field_id: undefined })
              }
            />
            <label className="text-xs font-medium">Target field</label>
            <Dropdown
              value={(opts.target_field_id as string) ?? null}
              placeholder="Pick field…"
              options={(targetFieldsQ.data ?? [])
                .filter((f) => f.type !== "rollup")
                .map((f) => ({ value: f.id, label: f.name }))}
              onChange={(v) => commit({ ...opts, target_field_id: v })}
            />
            <label className="text-xs font-medium">Function</label>
            <Dropdown
              value={(opts.function as string) ?? "count"}
              allowClear={false}
              options={[
                { value: "original", label: "Show original" },
                { value: "count", label: "Count" },
                { value: "sum", label: "Sum" },
                { value: "avg", label: "Average" },
                { value: "min", label: "Min" },
                { value: "max", label: "Max" },
                { value: "concat", label: "Concatenate" },
              ]}
              onChange={(v) => v && commit({ ...opts, function: v })}
            />
          </div>
        )}

        {field.type === "formula" && (
          <div className="space-y-2">
            <label className="text-xs font-medium">Expression</label>
            <div className="rounded-md border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground">
              {(opts.expression as string) || "—"}
            </div>
            <button
              type="button"
              onClick={() => setEditingFormula(true)}
              className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Edit formula
            </button>
          </div>
        )}

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
              Include time &amp; end date are set per cell.
            </p>
          </div>
        )}

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

      {editingFormula && (
        <FormulaEditor
          databaseId={databaseId}
          fields={dbFieldsQ.data ?? []}
          initial={(opts.expression as string) ?? ""}
          onSave={(expr) => commit({ ...opts, expression: expr })}
          onClose={() => setEditingFormula(false)}
        />
      )}
    </>
  );
}
