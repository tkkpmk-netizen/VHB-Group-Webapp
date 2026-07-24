import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Entity = components["schemas"]["EntityOut"];

/** The immutable per-database sequence is the default display ID. */
export function formatEntityId(entity: Entity, field?: Field) {
  const prefix = String(
    (field?.options as { prefix?: string } | undefined)?.prefix ?? "",
  ).trim();
  return `${prefix}${entity.seq}`;
}
