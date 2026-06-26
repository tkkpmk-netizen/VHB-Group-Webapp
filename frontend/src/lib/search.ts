/** Client-side full-table search: 3-layer ranked matching across all fields. */

import { toText } from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Row = components["schemas"]["RowOut"];

export type SearchHit = {
  row: Row;
  fieldId: string;
  fieldName: string;
  text: string;
  rank: 0 | 1 | 2; // 0 exact · 1 prefix · 2 contains
};

/** Searchable text for a cell (unique_id needs row.seq, rest via toText). */
export function cellSearchText(field: Field, row: Row): string {
  if (field.type === "unique_id") {
    const prefix = (field.options as { prefix?: string })?.prefix ?? "";
    return `${prefix}${row.seq}`;
  }
  const v = (row.data as Record<string, unknown>)[field.id] ?? null;
  return toText(field, v);
}

/** One best hit per row (lowest rank wins), sorted by rank. */
export function searchHits(rows: Row[], fields: Field[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const row of rows) {
    let best: SearchHit | null = null;
    for (const f of fields) {
      const text = cellSearchText(f, row);
      if (!text) continue;
      const lc = text.toLowerCase();
      const rank = lc === q ? 0 : lc.startsWith(q) ? 1 : lc.includes(q) ? 2 : -1;
      if (rank < 0) continue;
      if (!best || rank < best.rank)
        best = { row, fieldId: f.id, fieldName: f.name, text, rank: rank as 0 | 1 | 2 };
    }
    if (best) hits.push(best);
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

export function matchedRowIds(hits: SearchHit[]): Set<string> {
  return new Set(hits.map((h) => h.row.id));
}
