"use client";

import { useState } from "react";
import { Search, X } from "@/components/ui/fa-icon";
import { Dropdown } from "@/components/ui/dropdown";
import type { SearchHit } from "@/lib/search";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];

/** Highlight every case-insensitive occurrence of q in text. */
function highlight(text: string, q: string) {
  if (!q) return text;
  const parts = text.split(
    new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
  );
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="rounded bg-primary/30 text-foreground">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/** Always-visible search bar: field-scope chip + keyword + suggestions/preview. */
export function SearchBar({
  fields,
  hits,
  scopeFieldId,
  setScopeFieldId,
  query,
  setQuery,
  filterToMatches,
  setFilterToMatches,
  onJump,
}: {
  fields: Field[];
  hits: SearchHit[];
  scopeFieldId: string | null;
  setScopeFieldId: (id: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
  filterToMatches: boolean;
  setFilterToMatches: (b: boolean) => void;
  onJump: (rowId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = query.trim().length > 0;
  // Suggestions = distinct matched cell values (skip exact-equals).
  const suggestions = [
    ...new Set(hits.filter((h) => h.rank !== 0).map((h) => h.text)),
  ].slice(0, 6);

  return (
    <div className="relative">
      <div className="flex items-center gap-1 rounded-lg border bg-card px-2 py-1">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <div className="shrink-0 border-r pr-1">
          <Dropdown
            value={scopeFieldId}
            placeholder="All fields"
            options={fields.map((f) => ({ value: f.id, label: f.name }))}
            onChange={setScopeFieldId}
          />
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setOpen(false))}
          placeholder={
            scopeFieldId
              ? `Search in ${fields.find((f) => f.id === scopeFieldId)?.name ?? "field"}…`
              : "Search all fields…"
          }
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none"
        />
        {active && (
          <>
            <span className="shrink-0 text-xs text-muted-foreground">
              {hits.length}
            </span>
            <label className="flex shrink-0 items-center gap-1 px-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={filterToMatches}
                onChange={(e) => setFilterToMatches(e.target.checked)}
                className="size-3.5 accent-[var(--color-primary)]"
              />
              Only matches
            </label>
            <button
              onClick={() => setQuery("")}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </div>

      {open && active && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b p-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setQuery(s)}
                  className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {hits.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No matches
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={h.entity.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onJump(h.entity.id)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                <span className="text-xs text-muted-foreground">{h.fieldName}</span>
                <span className="line-clamp-2 text-sm">
                  {highlight(h.text, query)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
