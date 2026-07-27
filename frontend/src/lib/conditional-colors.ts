import { chipColor } from "./field-colors";
import { matchesFilter, type FilterGroup } from "./view";
import type { components } from "./api/schema";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];

export type ConditionalColorTarget = "rows" | "groups" | "both";
export type ConditionalColorMode = "none" | "tag" | "rules";

export type ConditionalColorRule = {
  id: string;
  fieldId: string;
  operator: string;
  value: string;
  color: string;
};

export type ConditionalColorConfig = {
  mode: ConditionalColorMode;
  target: ConditionalColorTarget;
  tagFieldId: string | null;
  rules: ConditionalColorRule[];
};

export const DEFAULT_CONDITIONAL_COLOR: ConditionalColorConfig = {
  mode: "none",
  target: "rows",
  tagFieldId: null,
  rules: [],
};

export function choiceColor(field: Field | undefined, value: unknown): string | null {
  if (!field) return null;
  const first = Array.isArray(value) ? value[0] : value;
  if (first == null || first === "") return null;
  const choices =
    (field.options as {
      choices?: { id: string; color?: string }[];
    })?.choices ?? [];
  return choices.find((choice) => choice.id === String(first))?.color ?? null;
}

export function colorSurface(colorId: string | null | undefined) {
  if (!colorId) return null;
  const color = chipColor(colorId);
  return {
    backgroundColor: `color-mix(in srgb, ${color.bg} 72%, transparent)`,
    borderColor: color.fg,
  };
}

export function conditionalColorForEntity(
  entity: Entity,
  fields: Field[],
  config: ConditionalColorConfig,
): string | null {
  if (config.mode === "none") return null;
  const byId = Object.fromEntries(fields.map((field) => [field.id, field]));
  if (config.mode === "tag") {
    const field = config.tagFieldId ? byId[config.tagFieldId] : undefined;
    const value = field
      ? (entity.data as Record<string, unknown>)[field.id]
      : null;
    return choiceColor(field, value);
  }
  for (const rule of config.rules) {
    const filter: FilterGroup = {
      conj: "and",
      rules: [
        {
          fieldId: rule.fieldId,
          op: rule.operator,
          value: rule.value,
        },
      ],
    };
    if (matchesFilter(entity, byId, filter)) return rule.color;
  }
  return null;
}

export function conditionalColorForGroup(
  groupField: Field | undefined,
  groupValue: unknown,
  config: ConditionalColorConfig,
): string | null {
  if (!groupField || config.mode === "none") return null;
  if (config.mode === "tag") {
    if (!config.tagFieldId || config.tagFieldId !== groupField.id) return null;
    return choiceColor(groupField, groupValue);
  }
  const groupEntity = {
    data: { [groupField.id]: groupValue },
  } as Entity;
  for (const rule of config.rules) {
    if (rule.fieldId !== groupField.id) continue;
    const filter: FilterGroup = {
      conj: "and",
      rules: [
        {
          fieldId: rule.fieldId,
          op: rule.operator,
          value: rule.value,
        },
      ],
    };
    if (matchesFilter(groupEntity, { [groupField.id]: groupField }, filter)) {
      return rule.color;
    }
  }
  return null;
}
