/** Client-side Filter / Sort / Group helpers for the table view. */

import { countryByCode } from "@/lib/countries";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];

export type FilterCond = { fieldId: string; op: string; value: string };
export type FilterGroup = { conj: "and" | "or"; rules: FilterNode[] };
export type FilterNode = FilterCond | FilterGroup;
export type SortRule = { fieldId: string; dir: "asc" | "desc" };

export function isGroup(n: FilterNode): n is FilterGroup {
  return (n as FilterGroup).rules !== undefined;
}

export function emptyGroup(): FilterGroup {
  return { conj: "and", rules: [] };
}

type Choice = { id: string; label: string };

const SELECT_LIKE = new Set(["select", "status", "priority"]);
const MULTI_LIKE = new Set(["multi_select", "relation", "files"]);
const NUM_LIKE = new Set(["number", "rating"]);

function choices(field: Field): Choice[] {
  const raw = (field.options as { choices?: Choice[] })?.choices;
  return Array.isArray(raw) ? raw : [];
}

function choiceLabel(field: Field, id: string): string {
  return choices(field).find((c) => c.id === id)?.label ?? id;
}

function raw(row: Row, field: Field): unknown {
  return (row.data as Record<string, unknown>)[field.id] ?? null;
}

export function toText(field: Field, value: unknown): string {
  if (value == null) return "";
  const t = field.type;
  if (t === "checkbox") return value ? "✓" : "";
  if (t === "country") return countryByCode(String(value))?.name ?? String(value);
  if (SELECT_LIKE.has(t)) return choiceLabel(field, String(value));
  if (t === "multi_select" && Array.isArray(value))
    return value.map((id) => choiceLabel(field, String(id))).join(", ");
  if (t === "files" && Array.isArray(value))
    return value
      .map((item) =>
        item && typeof item === "object" && "name" in item
          ? String((item as { name?: unknown }).name ?? "")
          : String(item),
      )
      .filter(Boolean)
      .join(", ");
  if (t === "date" && typeof value === "object" && value !== null)
    return String((value as { start?: string }).start ?? "");
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** Human-friendly value for read-only display (List/Gallery): formats dates
 *  (start → end, no raw ISO "T"); falls back to toText otherwise. */
export function displayText(field: Field, value: unknown): string {
  if (value == null || value === "") return "";
  const fmtIso = (s?: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return s.includes("T") ? d.toLocaleString() : d.toLocaleDateString();
  };
  if (field.type === "date") {
    const o =
      typeof value === "object"
        ? (value as { start?: string; end?: string | null })
        : { start: String(value), end: null };
    return fmtIso(o.start) + (o.end ? ` → ${fmtIso(o.end)}` : "");
  }
  if (field.type === "created_time" || field.type === "last_edited_time")
    return fmtIso(String(value));
  return toText(field, value);
}

function toNum(value: unknown): number | null {
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function operatorsFor(type: string): { value: string; label: string }[] {
  if (type === "checkbox")
    return [
      { value: "checked", label: "is checked" },
      { value: "unchecked", label: "is unchecked" },
    ];
  if (NUM_LIKE.has(type))
    return [
      { value: "eq", label: "=" },
      { value: "ne", label: "≠" },
      { value: "gt", label: ">" },
      { value: "lt", label: "<" },
      { value: "empty", label: "is empty" },
      { value: "not_empty", label: "is not empty" },
    ];
  if (type === "date")
    return [
      { value: "on", label: "is" },
      { value: "before", label: "before" },
      { value: "after", label: "after" },
      { value: "empty", label: "is empty" },
      { value: "not_empty", label: "is not empty" },
    ];
  if (SELECT_LIKE.has(type))
    return [
      { value: "is", label: "is" },
      { value: "is_not", label: "is not" },
      { value: "empty", label: "is empty" },
      { value: "not_empty", label: "is not empty" },
    ];
  if (MULTI_LIKE.has(type))
    return [
      { value: "contains", label: "contains" },
      { value: "not_contains", label: "does not contain" },
      { value: "empty", label: "is empty" },
      { value: "not_empty", label: "is not empty" },
    ];
  return [
    { value: "equals", label: "Is" },
    { value: "not_equals", label: "Is not" },
    { value: "contains", label: "Contains" },
    { value: "not_contains", label: "Does not contain" },
    { value: "starts_with", label: "Starts with" },
    { value: "ends_with", label: "Ends with" },
    { value: "empty", label: "Is empty" },
    { value: "not_empty", label: "Is not empty" },
  ];
}

/** Does the op need a value input? */
export function opNeedsValue(op: string): boolean {
  return !["empty", "not_empty", "checked", "unchecked"].includes(op);
}

function matchOne(field: Field, value: unknown, op: string, target: string): boolean {
  switch (op) {
    case "empty":
      return isEmpty(value);
    case "not_empty":
      return !isEmpty(value);
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
    case "is":
      return String(value) === target;
    case "is_not":
      return String(value) !== target;
    case "contains":
      if (Array.isArray(value)) return value.map(String).includes(target);
      return toText(field, value).toLowerCase().includes(target.toLowerCase());
    case "not_contains":
      if (Array.isArray(value)) return !value.map(String).includes(target);
      return !toText(field, value).toLowerCase().includes(target.toLowerCase());
    case "equals":
      return toText(field, value).toLowerCase() === target.toLowerCase();
    case "not_equals":
      return toText(field, value).toLowerCase() !== target.toLowerCase();
    case "starts_with":
      return toText(field, value).toLowerCase().startsWith(target.toLowerCase());
    case "ends_with":
      return toText(field, value).toLowerCase().endsWith(target.toLowerCase());
    case "eq":
      return toNum(value) === toNum(target);
    case "ne":
      return toNum(value) !== toNum(target);
    case "gt":
      return (toNum(value) ?? -Infinity) > (toNum(target) ?? 0);
    case "lt":
      return (toNum(value) ?? Infinity) < (toNum(target) ?? 0);
    case "on":
      return toText(field, value).slice(0, 10) === target;
    case "before":
      return toText(field, value).slice(0, 10) < target;
    case "after":
      return toText(field, value).slice(0, 10) > target;
    default:
      return true;
  }
}

function matchNode(
  row: Row,
  byId: Record<string, Field>,
  node: FilterNode,
): boolean {
  if (isGroup(node)) {
    const active = node.rules.filter((r) =>
      isGroup(r) ? r.rules.length > 0 : r.fieldId && byId[r.fieldId],
    );
    if (active.length === 0) return true;
    const results = active.map((r) => matchNode(row, byId, r));
    return node.conj === "and" ? results.every(Boolean) : results.some(Boolean);
  }
  const f = byId[node.fieldId];
  if (!f) return true;
  return matchOne(f, raw(row, f), node.op, node.value);
}

export function countRules(group: FilterGroup): number {
  return group.rules.reduce(
    (n, r) => n + (isGroup(r) ? countRules(r) : 1),
    0,
  );
}

export function applyFilterTree(
  rows: Row[],
  byId: Record<string, Field>,
  root: FilterGroup,
): Row[] {
  if (root.rules.length === 0) return rows;
  return rows.filter((row) => matchNode(row, byId, root));
}

export function applySorts(
  rows: Row[],
  byId: Record<string, Field>,
  sorts: SortRule[],
): Row[] {
  const active = sorts.filter((s) => s.fieldId && byId[s.fieldId]);
  if (active.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of active) {
      const f = byId[s.fieldId];
      const va = raw(a, f);
      const vb = raw(b, f);
      // Empty values always sort to the bottom, regardless of direction.
      const ea = isEmpty(va);
      const eb = isEmpty(vb);
      if (ea && eb) continue;
      if (ea) return 1;
      if (eb) return -1;
      let cmp = 0;
      if (NUM_LIKE.has(f.type)) {
        cmp = (toNum(va) ?? 0) - (toNum(vb) ?? 0);
      } else {
        cmp = toText(f, va).localeCompare(toText(f, vb), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

export function groupRows(
  rows: Row[],
  field: Field,
): { key: string; label: string; value: unknown; rows: Row[] }[] {
  const map = new Map<string, { label: string; value: unknown; rows: Row[] }>();
  for (const row of rows) {
    const v = raw(row, field);
    const label = toText(field, v) || "Empty";
    if (!map.has(label)) map.set(label, { label, value: v, rows: [] });
    map.get(label)!.rows.push(row);
  }
  return [...map.entries()].map(([key, v]) => ({ key, ...v }));
}
