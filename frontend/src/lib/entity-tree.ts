/** Merge Entity-like records while preserving one stable React identity per id.
 *
 * Later groups win so a freshly loaded page can override an older hierarchy
 * snapshot without changing the first-seen display order.
 */
export function mergeUniqueById<T extends { id: string }>(
  ...groups: ReadonlyArray<ReadonlyArray<T>>
): T[] {
  const merged = new Map<string, T>();
  for (const group of groups) {
    for (const item of group) merged.set(item.id, item);
  }
  return [...merged.values()];
}
