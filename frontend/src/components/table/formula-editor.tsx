"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];

const FUNCTIONS: { name: string; snippet: string; hint: string }[] = [
  { name: "if", snippet: "if(, , )", hint: "if(condition, then, else)" },
  { name: "and", snippet: "and(, )", hint: "and(a, b)" },
  { name: "or", snippet: "or(, )", hint: "or(a, b)" },
  { name: "not", snippet: "not()", hint: "not(a)" },
  { name: "empty", snippet: "empty()", hint: "is empty" },
  { name: "concat", snippet: "concat(, )", hint: "join text" },
  { name: "join", snippet: 'join(", ", )', hint: "join(sep, list)" },
  { name: "length", snippet: "length()", hint: "text/list length" },
  { name: "substring", snippet: "substring(, 0, 3)", hint: "substring(s, a, b)" },
  { name: "replace", snippet: "replace(, , )", hint: "replace(s, old, new)" },
  { name: "contains", snippet: "contains(, )", hint: "contains(s, sub)" },
  { name: "lower", snippet: "lower()", hint: "lowercase" },
  { name: "upper", snippet: "upper()", hint: "uppercase" },
  { name: "round", snippet: "round(, 2)", hint: "round(x, n)" },
  { name: "abs", snippet: "abs()", hint: "absolute" },
  { name: "min", snippet: "min(, )", hint: "minimum" },
  { name: "max", snippet: "max(, )", hint: "maximum" },
  { name: "sum", snippet: "sum()", hint: "sum numbers" },
  { name: "ceil", snippet: "ceil()", hint: "round up" },
  { name: "floor", snippet: "floor()", hint: "round down" },
  { name: "mod", snippet: "mod(, )", hint: "remainder" },
  { name: "pow", snippet: "pow(, )", hint: "power" },
  { name: "now", snippet: "now()", hint: "current datetime" },
  { name: "today", snippet: "today()", hint: "current date" },
  { name: "dateAdd", snippet: 'dateAdd(, 1, "days")', hint: "add to date" },
  { name: "dateBetween", snippet: 'dateBetween(, now(), "days")', hint: "diff" },
  { name: "year", snippet: "year()", hint: "year of date" },
];

export function FormulaEditor({
  databaseId,
  fields,
  initial,
  onSave,
  onClose,
}: {
  databaseId: string;
  fields: Field[];
  initial: string;
  onSave: (expr: string) => void;
  onClose: () => void;
}) {
  const [expr, setExpr] = useState(initial);
  const [debug, setDebug] = useState(true);
  const [preview, setPreview] = useState<{
    value: unknown;
    type: string;
    error?: string | null;
  } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Live preview against the first row (debounced).
  useEffect(() => {
    const t = setTimeout(() => {
      if (!expr.trim()) {
        setPreview(null);
        return;
      }
      apiFetch<{ value: unknown; type: string; error?: string | null }>(
        `/databases/${databaseId}/formula-preview`,
        { method: "POST", body: JSON.stringify({ expression: expr }) },
      )
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(t);
  }, [expr, databaseId]);

  function insert(text: string) {
    const ta = ref.current;
    const start = ta?.selectionStart ?? expr.length;
    const end = ta?.selectionEnd ?? expr.length;
    const next = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    setTimeout(() => {
      ta?.focus();
      const pos = start + text.length;
      ta?.setSelectionRange(pos, pos);
    }, 0);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border bg-popover text-popover-foreground shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Edit formula</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <textarea
            ref={ref}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            rows={3}
            autoFocus
            placeholder={'if(prop("Total") > 1000, "VIP", "Normal")'}
            className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm">
              {preview?.error ? (
                debug ? (
                  <span className="text-destructive">⚠ {preview.error}</span>
                ) : (
                  <span className="text-muted-foreground">No output</span>
                )
              ) : preview ? (
                <span className="font-medium">{String(preview.value)}</span>
              ) : (
                <span className="text-muted-foreground">No output</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={debug}
                  onChange={(e) => setDebug(e.target.checked)}
                  className="size-3.5 accent-[var(--color-primary)]"
                />
                Debug
              </label>
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {preview?.error ? "error" : (preview?.type ?? "—")}
              </span>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden border-t bg-border">
          <div className="overflow-y-auto bg-popover p-2">
            <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
              Properties
            </p>
            {fields
              .filter((f) => f.type !== "formula")
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => insert(`prop("${f.name}")`)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  {f.name}
                  <span className="text-xs text-muted-foreground">{f.type}</span>
                </button>
              ))}
          </div>
          <div className="overflow-y-auto bg-popover p-2">
            <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">
              Functions
            </p>
            {FUNCTIONS.map((fn) => (
              <button
                key={fn.name}
                onClick={() => insert(fn.snippet)}
                title={fn.hint}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="font-mono">{fn.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {fn.hint}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(expr);
              onClose();
            }}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
