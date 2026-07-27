export type DragPreviewKind =
  | "board-card"
  | "calendar-item"
  | "column"
  | "database"
  | "field"
  | "layout"
  | "row"
  | "tree-item";

export const DRAG_CANCEL_EVENT = "vhb:drag-cancel";
export const DRAG_END_EVENT = "vhb:drag-end";
export const DRAG_START_EVENT = "vhb:drag-start";

const PREVIEW_LIMITS: Record<
  DragPreviewKind,
  { min: number; max: number }
> = {
  "board-card": { min: 176, max: 256 },
  "calendar-item": { min: 144, max: 224 },
  column: { min: 152, max: 232 },
  database: { min: 160, max: 240 },
  field: { min: 152, max: 224 },
  layout: { min: 128, max: 200 },
  row: { min: 176, max: 248 },
  "tree-item": { min: 152, max: 224 },
};

export function isDragPreviewKind(value: string): value is DragPreviewKind {
  return value in PREVIEW_LIMITS;
}

export function dragPreviewWidth(
  sourceWidth: number,
  kind: DragPreviewKind,
) {
  const limits = PREVIEW_LIMITS[kind];
  return Math.min(Math.max(sourceWidth, limits.min), limits.max);
}

/**
 * Moves one or more items as a contiguous block immediately before `targetId`.
 * The block keeps the same relative order it had in the source list.
 */
export function moveItemsBefore(
  ids: string[],
  movingIds: Iterable<string>,
  targetId: string,
): string[] {
  const requested = new Set(movingIds);
  if (!requested.size || requested.has(targetId)) return ids;

  const moving = ids.filter((id) => requested.has(id));
  if (!moving.length) return ids;

  const remaining = ids.filter((id) => !requested.has(id));
  const targetIndex = remaining.indexOf(targetId);
  const insertionIndex = targetIndex < 0 ? remaining.length : targetIndex;
  return [
    ...remaining.slice(0, insertionIndex),
    ...moving,
    ...remaining.slice(insertionIndex),
  ];
}
