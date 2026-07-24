"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Check,
  LoaderCircle,
  Plus,
  Trash2,
} from "@/components/ui/fa-icon";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { IconPicker } from "@/components/ui/icon-picker";
import { FormulaEditor } from "@/components/table/formula-editor";
import { CHIP_COLORS, chipColor, STATUS_GROUPS } from "@/lib/field-colors";
import type { components } from "@/lib/api/schema";
import { defaultIconForFieldType } from "@/lib/icon-system";

type Field = components["schemas"]["FieldOut"];
type FieldType = Field["type"];
type Choice = { id: string; label: string; color?: string; group?: string };
type Options = Record<string, unknown> & { choices?: Choice[] };
type FieldTypeConversionResult =
  components["schemas"]["FieldTypeConversionResult"];

const CONVERTIBLE_FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "long_text", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "country", label: "Country" },
  { value: "select", label: "Select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "rating", label: "Rating" },
  { value: "people", label: "People" },
  { value: "progress", label: "Progress" },
];
const CONVERTIBLE_TYPE_SET = new Set(
  CONVERTIBLE_FIELD_TYPES.map((type) => type.value),
);

function fieldTypeLabel(type: FieldType) {
  return (
    CONVERTIBLE_FIELD_TYPES.find((option) => option.value === type)?.label ??
    type.replaceAll("_", " ")
  );
}

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
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const c = chipColor(value);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) return setOpen(false);
          const rect = triggerRef.current?.getBoundingClientRect();
          if (!rect) return;
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 252)),
            top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 238)),
          });
          setOpen(true);
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white shadow-sm ring-1 ring-border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundColor: c.bg }}
        title={`Change color: ${c.label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="size-2 rounded-full bg-white/65" />
      </button>
      {open && position
        ? createPortal(
            <motion.div
              ref={popoverRef}
              role="dialog"
              aria-label="Choose option color"
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-[170] w-[244px] rounded-xl border bg-popover p-2 shadow-[var(--shadow-popover)]"
              style={position}
            >
              <p className="px-1 pb-2 text-[11px] font-semibold text-muted-foreground">
                Option color
              </p>
              <div className="grid grid-cols-2 gap-1">
                {CHIP_COLORS.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => {
                      onChange(col.id);
                      setOpen(false);
                    }}
                    className={`flex h-8 items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-muted ${
                      value === col.id ? "bg-muted font-medium" : ""
                    }`}
                    aria-pressed={value === col.id}
                  >
                    <span
                      className="flex size-4 items-center justify-center rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: col.bg }}
                    >
                      {value === col.id ? <Check className="size-2.5" style={{ color: col.fg }} /> : null}
                    </span>
                    <span className="truncate">{col.label}</span>
                  </button>
                ))}
              </div>
            </motion.div>,
            document.body,
          )
        : null}
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
        className="flex-1 rounded-md border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
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
  onTypeChanged,
}: {
  field: Field;
  databaseId: string;
  onTypeChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(field.name);
  const [icon, setIcon] = useState(field.icon || defaultIconForFieldType(field.type));
  const [iconColor, setIconColor] = useState(field.icon_color || "#1264d7");
  const [opts, setOpts] = useState<Options>((field.options as Options) ?? {});
  const [editingFormula, setEditingFormula] = useState(false);
  const [pendingType, setPendingType] = useState<FieldType | null>(null);
  const [conversionPreview, setConversionPreview] =
    useState<FieldTypeConversionResult | null>(null);

  const patch = useMutation({
    mutationFn: (body: { name: string; options: Options; icon: string; icon_color: string }) =>
      apiFetch<Field>(`/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
    },
  });

  const previewTypeConversion = useMutation({
    mutationFn: (targetType: FieldType) =>
      apiFetch<FieldTypeConversionResult>(`/fields/${field.id}/convert-type`, {
        method: "POST",
        body: JSON.stringify({
          target_type: targetType,
          dry_run: true,
        }),
      }),
    onSuccess: setConversionPreview,
  });

  const applyTypeConversion = useMutation({
    mutationFn: (targetType: FieldType) =>
      apiFetch<FieldTypeConversionResult>(`/fields/${field.id}/convert-type`, {
        method: "POST",
        body: JSON.stringify({
          target_type: targetType,
          dry_run: false,
        }),
      }),
    onSuccess: (result) => {
      if (result.field) {
        setOpts((result.field.options as Options) ?? {});
      }
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      qc.invalidateQueries({ queryKey: ["entities", databaseId] });
      setPendingType(null);
      setConversionPreview(null);
      onTypeChanged?.();
    },
  });

  function commit(nextOpts: Options, nextName = name) {
    setOpts(nextOpts);
    patch.mutate({ name: nextName.trim() || field.name, options: nextOpts, icon, icon_color: iconColor });
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
      <div className="mb-2 flex items-center gap-2">
        <IconPicker
          value={icon}
          onChange={(nextIcon) => {
            setIcon(nextIcon);
            patch.mutate({ name: name.trim() || field.name, options: opts, icon: nextIcon, icon_color: iconColor });
          }}
          onColorChange={(nextColor) => {
            setIconColor(nextColor);
            patch.mutate({ name: name.trim() || field.name, options: opts, icon, icon_color: nextColor });
          }}
          label={`Choose icon for field ${field.name}`}
          color={iconColor}
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit(opts)}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs font-medium outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="mb-3 rounded-lg border bg-muted/20 p-2.5">
        <label className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
          Field type
        </label>
        {CONVERTIBLE_TYPE_SET.has(field.type) ? (
          <Dropdown
            value={field.type}
            allowClear={false}
            options={CONVERTIBLE_FIELD_TYPES}
            onChange={(value) => {
              if (!value || value === field.type) return;
              const targetType = value as FieldType;
              setPendingType(targetType);
              setConversionPreview(null);
              previewTypeConversion.mutate(targetType);
            }}
          />
        ) : (
          <div className="flex h-8 items-center rounded-md border bg-background px-2 text-xs capitalize text-muted-foreground">
            {fieldTypeLabel(field.type)}
            <span className="ml-auto text-[10px]">Read-only type</span>
          </div>
        )}
      </div>
      <div className="space-y-3 px-1 py-2">
        {![
          "unique_id",
          "rollup",
          "formula",
          "created_time",
          "created_by",
          "last_edited_time",
          "last_edited_by",
        ].includes(field.type) && (
          <div className="rounded-lg border bg-muted/25 p-2.5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Field rules
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={opts.required === true}
                onChange={(event) => commit({ ...opts, required: event.target.checked })}
                className="size-4 accent-[var(--color-primary)]"
              />
              <span className="flex-1">Required</span>
            </label>
            <label className="mt-2 block text-xs text-muted-foreground">
              Who can edit values
              <div className="mt-1">
                <Dropdown
                  value={(opts.edit_permission as string) ?? "workspace"}
                  allowClear={false}
                  options={[
                    { value: "workspace", label: "All editors" },
                    { value: "admins", label: "Admins & owners" },
                  ]}
                  onChange={(value) => value && commit({ ...opts, edit_permission: value })}
                />
              </div>
            </label>
            <label className="mt-2 block text-xs text-muted-foreground">
              Cell alignment
              <div className="mt-1">
                <Dropdown
                  value={(opts.alignment as string) ?? "auto"}
                  allowClear={false}
                  options={[
                    { value: "auto", label: "Auto" },
                    { value: "left", label: "Left" },
                    { value: "center", label: "Center" },
                    { value: "right", label: "Right" },
                  ]}
                  onChange={(value) => value && commit({ ...opts, alignment: value })}
                />
              </div>
            </label>
          </div>
        )}
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
              <label className="flex items-center justify-between text-xs">
                Decimal places
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={(opts.precision as number) ?? 2}
                  onChange={(e) =>
                    commit({ ...opts, precision: Number(e.target.value) })
                  }
                  className="w-16 rounded-md border bg-background px-2 py-1 text-xs"
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
              className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              Edit formula
            </button>
          </div>
        )}

        {field.type === "unique_id" && (
          <label className="flex items-center justify-between text-xs">
            Prefix
            <input
              value={(opts.prefix as string) ?? ""}
              onChange={(e) => commit({ ...opts, prefix: e.target.value })}
              placeholder="e.g. VHB-"
              className="w-28 rounded-md border bg-background px-2 py-1 text-xs"
            />
          </label>
        )}

        {field.type === "url" && (
          <label className="flex items-center gap-2 text-xs">
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
              className="flex items-center gap-1 text-xs text-primary hover:underline"
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

      {pendingType &&
        createPortal(
          <div className="fixed inset-0 z-[180] flex items-start justify-center bg-black/30 p-4 pt-[18vh]">
            <button
              type="button"
              aria-label="Close field type conversion"
              className="absolute inset-0"
              onClick={() => {
                if (applyTypeConversion.isPending) return;
                setPendingType(null);
                setConversionPreview(null);
              }}
            />
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="field-type-conversion-title"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-[var(--shadow-popover)]"
            >
              <div className="border-b px-4 py-3">
                <h2
                  id="field-type-conversion-title"
                  className="text-sm font-semibold"
                >
                  Change field type
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Existing values will be mapped before the field type changes.
                </p>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs">
                  <span className="flex-1 font-medium">
                    {fieldTypeLabel(field.type)}
                  </span>
                  <ArrowRight className="size-3 text-muted-foreground" />
                  <span className="flex-1 text-right font-medium text-primary">
                    {fieldTypeLabel(pendingType)}
                  </span>
                </div>

                {previewTypeConversion.isPending ? (
                  <div className="flex min-h-24 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    Checking existing cells…
                  </div>
                ) : previewTypeConversion.isError ? (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {previewTypeConversion.error instanceof Error
                        ? previewTypeConversion.error.message
                        : "Could not preview this conversion."}
                    </span>
                  </div>
                ) : conversionPreview ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="rounded-lg border p-2 text-center">
                        <strong className="block text-sm text-emerald-600">
                          {conversionPreview.converted_cells}
                        </strong>
                        <span className="text-[10px] text-muted-foreground">
                          Mapped
                        </span>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <strong
                          className={`block text-sm ${
                            conversionPreview.cleared_cells
                              ? "text-destructive"
                              : "text-foreground"
                          }`}
                        >
                          {conversionPreview.cleared_cells}
                        </strong>
                        <span className="text-[10px] text-muted-foreground">
                          Cleared
                        </span>
                      </div>
                      <div className="rounded-lg border p-2 text-center">
                        <strong className="block text-sm">
                          {conversionPreview.empty_cells}
                        </strong>
                        <span className="text-[10px] text-muted-foreground">
                          Empty
                        </span>
                      </div>
                    </div>
                    {conversionPreview.generated_choices > 0 && (
                      <p className="rounded-md bg-primary/5 px-2.5 py-2 text-[11px] text-primary">
                        {conversionPreview.generated_choices} options will be
                        created from existing values.
                      </p>
                    )}
                    {conversionPreview.cleared_cells > 0 && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          Incompatible cells will be permanently cleared.
                          {(conversionPreview.cleared_samples ?? []).length
                            ? ` Examples: ${(conversionPreview.cleared_samples ?? []).join(", ")}.`
                            : ""}
                        </span>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
              <div className="flex items-center justify-end gap-2 border-t bg-muted/15 px-4 py-3">
                <button
                  type="button"
                  disabled={applyTypeConversion.isPending}
                  onClick={() => {
                    setPendingType(null);
                    setConversionPreview(null);
                  }}
                  className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    !conversionPreview ||
                    previewTypeConversion.isPending ||
                    applyTypeConversion.isPending
                  }
                  onClick={() => applyTypeConversion.mutate(pendingType)}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {applyTypeConversion.isPending && (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  )}
                  Change type
                </button>
              </div>
            </motion.section>
          </div>,
          document.body,
        )}
    </>
  );
}
