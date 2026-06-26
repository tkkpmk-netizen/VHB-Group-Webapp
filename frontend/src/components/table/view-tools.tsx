"use client";

import { Plus, Trash2, X } from "lucide-react";
import { Dropdown } from "@/components/ui/dropdown";
import {
  emptyGroup,
  type FilterGroup,
  type FilterNode,
  isGroup,
  opNeedsValue,
  operatorsFor,
  type SortRule,
} from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Choice = { id: string; label: string };

function fieldOptions(fields: Field[]) {
  return fields.map((f) => ({ value: f.id, label: f.name }));
}

const SORT_DIR_OPTIONS = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

function FilterValue({
  field,
  op,
  value,
  onChange,
}: {
  field?: Field;
  op: string;
  value: string;
  onChange: (v: string) => void;
}) {
  if (!field || !opNeedsValue(op)) return null;
  const t = field.type;
  if (["select", "status", "priority", "multi_select"].includes(t)) {
    const choices = ((field.options as { choices?: Choice[] })?.choices ?? []).map(
      (c) => ({ value: c.id, label: c.label }),
    );
    return (
      <Dropdown value={value || null} options={choices} onChange={(v) => onChange(v ?? "")} />
    );
  }
  const inputType = ["number", "rating"].includes(t)
    ? "number"
    : t === "date"
      ? "date"
      : "text";
  return (
    <input
      type={inputType}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value"
      className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

/** Recursive editor for a Notion-style nested filter group. */
export function FilterGroupEditor({
  group,
  fields,
  onChange,
  depth = 0,
}: {
  group: FilterGroup;
  fields: Field[];
  onChange: (g: FilterGroup) => void;
  depth?: number;
}) {
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));

  function setRule(i: number, node: FilterNode) {
    const rules = [...group.rules];
    rules[i] = node;
    onChange({ ...group, rules });
  }
  function removeRule(i: number) {
    onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) });
  }
  function addRule() {
    const f = fields[0];
    onChange({
      ...group,
      rules: [
        ...group.rules,
        { fieldId: f?.id ?? "", op: operatorsFor(f?.type ?? "text")[0].value, value: "" },
      ],
    });
  }

  return (
    <div className={depth > 0 ? "rounded-lg border bg-muted/30 p-2" : ""}>
      <div className="space-y-2">
        {group.rules.map((node, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-14 shrink-0 pt-1.5 text-xs text-muted-foreground">
              {i === 0 ? (
                "Where"
              ) : i === 1 ? (
                <Dropdown
                  value={group.conj}
                  allowClear={false}
                  options={[
                    { value: "and", label: "And" },
                    { value: "or", label: "Or" },
                  ]}
                  onChange={(v) =>
                    onChange({ ...group, conj: (v as "and" | "or") ?? "and" })
                  }
                />
              ) : (
                <span className="px-2 capitalize">{group.conj}</span>
              )}
            </div>
            <div className="flex-1">
              {isGroup(node) ? (
                <FilterGroupEditor
                  group={node}
                  fields={fields}
                  depth={depth + 1}
                  onChange={(g) => setRule(i, g)}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <div className="w-24 shrink-0">
                    <Dropdown
                      value={node.fieldId || null}
                      options={fieldOptions(fields)}
                      onChange={(v) => {
                        const nf = byId[v ?? ""];
                        setRule(i, {
                          fieldId: v ?? "",
                          op: nf ? operatorsFor(nf.type)[0].value : "contains",
                          value: "",
                        });
                      }}
                    />
                  </div>
                  <div className="w-24 shrink-0">
                    <Dropdown
                      value={node.op}
                      allowClear={false}
                      options={operatorsFor(byId[node.fieldId]?.type ?? "text")}
                      onChange={(v) => setRule(i, { ...node, op: v ?? node.op })}
                    />
                  </div>
                  <div className="flex-1">
                    <FilterValue
                      field={byId[node.fieldId]}
                      op={node.op}
                      value={node.value}
                      onChange={(v) => setRule(i, { ...node, value: v })}
                    />
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() => removeRule(i)}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3">
        <button
          onClick={addRule}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <Plus className="size-3.5" /> Add filter rule
        </button>
        {depth === 0 && (
          <button
            onClick={() => onChange({ ...group, rules: [...group.rules, emptyGroup()] })}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            <Plus className="size-3.5" /> Add filter group
          </button>
        )}
      </div>
    </div>
  );
}

export function SortEditor({
  fields,
  sorts,
  setSorts,
}: {
  fields: Field[];
  sorts: SortRule[];
  setSorts: (s: SortRule[]) => void;
}) {
  return (
    <div>
      <div className="space-y-2">
        {sorts.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex-1">
              <Dropdown
                value={s.fieldId || null}
                options={fieldOptions(fields)}
                onChange={(v) => {
                  const next = [...sorts];
                  next[i] = { ...s, fieldId: v ?? "" };
                  setSorts(next);
                }}
              />
            </div>
            <div className="w-32">
              <Dropdown
                value={s.dir}
                allowClear={false}
                options={SORT_DIR_OPTIONS}
                onChange={(v) => {
                  const next = [...sorts];
                  next[i] = { ...s, dir: (v as "asc" | "desc") ?? "asc" };
                  setSorts(next);
                }}
              />
            </div>
            <button
              onClick={() => setSorts(sorts.filter((_, j) => j !== i))}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => setSorts([...sorts, { fieldId: fields[0]?.id ?? "", dir: "asc" }])}
        className="mt-2 flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <Plus className="size-3.5" /> Add sort
      </button>
    </div>
  );
}

export function GroupEditor({
  fields,
  groupFieldId,
  setGroupFieldId,
  hideEmpty,
  setHideEmpty,
}: {
  fields: Field[];
  groupFieldId: string | null;
  setGroupFieldId: (id: string | null) => void;
  hideEmpty: boolean;
  setHideEmpty: (b: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">Group by</span>
        <div className="w-40">
          <Dropdown
            value={groupFieldId}
            placeholder="None"
            options={fieldOptions(fields)}
            onChange={(v) => setGroupFieldId(v)}
          />
        </div>
      </div>
      {groupFieldId && (
        <>
          <label className="flex items-center justify-between text-sm">
            Hide empty groups
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="size-4 accent-[var(--color-primary)]"
            />
          </label>
          <button
            onClick={() => setGroupFieldId(null)}
            className="flex items-center gap-1 border-t pt-2 text-sm text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Remove grouping
          </button>
        </>
      )}
    </div>
  );
}
