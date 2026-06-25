"use client";

import { useState } from "react";
import { ExternalLink, Star } from "lucide-react";
import { Dropdown, MultiDropdown } from "@/components/ui/dropdown";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type Choice = { id: string; label: string; color?: string; group?: string };

function choiceOptions(field: Field) {
  const raw = (field.options as { choices?: Choice[] })?.choices;
  return (Array.isArray(raw) ? raw : []).map((c) => ({
    value: c.id,
    label: c.label,
    color: c.color,
  }));
}

const SELECT_LIKE = new Set(["select", "status", "priority"]);
const TEXT_TYPES = new Set(["text", "long_text", "phone", "email", "url"]);

const inputCls =
  "w-full rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-accent/40";
const displayCls = "min-h-[34px] cursor-text truncate px-2 py-1.5 text-sm";
const dash = <span className="text-muted-foreground">—</span>;

type CellProps = {
  field: Field;
  value: unknown;
  onCommit: (value: unknown) => void;
};

type NumberOptions = {
  format?: "plain" | "integer" | "decimal" | "percent" | "currency";
  currency_code?: string;
  precision?: number;
};

function displayNumber(field: Field, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const opt = (field.options as NumberOptions) ?? {};
  if (opt.format === "currency") {
    try {
      return n.toLocaleString("en-US", {
        style: "currency",
        currency: opt.currency_code || "VND",
        maximumFractionDigits: opt.precision ?? 0,
      });
    } catch {
      return `${n.toLocaleString("en-US")} ${opt.currency_code ?? ""}`;
    }
  }
  if (opt.format === "percent") return `${n}%`;
  if (opt.format === "decimal") {
    const p = opt.precision ?? 2;
    return n.toLocaleString("en-US", {
      minimumFractionDigits: p,
      maximumFractionDigits: p,
    });
  }
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDate(field: Field, value: string): string {
  const fmt = (field.options as { date_format?: string })?.date_format ?? "iso";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  const [, y, mo, d] = m;
  if (fmt === "dmy") return `${d}/${mo}/${y}`;
  if (fmt === "mdy") return `${mo}/${d}/${y}`;
  if (fmt === "ymd") return `${y}/${mo}/${d}`;
  return `${y}-${mo}-${d}`;
}

function TextCell({ field, value, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState("");
  const multiline = field.type === "long_text";
  const inputType =
    field.type === "email" ? "email" : field.type === "url" ? "url" : "text";

  if (editing) {
    const commit = () => {
      setEditing(false);
      onCommit(local === "" ? null : local);
    };
    return multiline ? (
      <textarea
        autoFocus
        rows={2}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        className={inputCls}
      />
    ) : (
      <input
        autoFocus
        type={inputType}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        className={inputCls}
      />
    );
  }

  const hyperlink =
    field.type === "url" &&
    (field.options as { hyperlink?: boolean })?.hyperlink === true;
  const text = typeof value === "string" ? value : "";
  const href = text ? (text.startsWith("http") ? text : `https://${text}`) : "";

  return (
    <div className="flex items-center">
      <div
        onClick={() => {
          setLocal(text);
          setEditing(true);
        }}
        className={`flex-1 ${displayCls}`}
      >
        {text || dash}
      </div>
      {hyperlink && href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="px-1 text-primary"
          title="Open link"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}

function NumberCell({ field, value, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState("");
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="decimal"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const n = Number(local);
          onCommit(local === "" || Number.isNaN(n) ? null : n);
        }}
        className={inputCls}
      />
    );
  }
  return (
    <div
      onClick={() => {
        setLocal(value == null ? "" : String(value));
        setEditing(true);
      }}
      className={displayCls}
    >
      {displayNumber(field, value) || dash}
    </div>
  );
}

function DateCell({ field, value, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={typeof value === "string" ? value : ""}
        onBlur={(e) => {
          setEditing(false);
          onCommit(e.target.value || null);
        }}
        className={inputCls}
      />
    );
  }
  return (
    <div onClick={() => setEditing(true)} className={displayCls}>
      {typeof value === "string" && value ? formatDate(field, value) : dash}
    </div>
  );
}

function RatingCell({ value, onCommit }: CellProps) {
  const n = typeof value === "number" ? value : 0;
  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onCommit(i === n ? null : i)}
          className="leading-none"
          title={`${i}`}
        >
          <Star
            className="size-4"
            style={{
              color: i <= n ? "#f59e0b" : "var(--color-muted-foreground)",
              fill: i <= n ? "#f59e0b" : "none",
            }}
          />
        </button>
      ))}
    </div>
  );
}

function SelectCell({ field, value, onCommit }: CellProps) {
  return (
    <div className="py-0.5">
      <Dropdown
        value={typeof value === "string" ? value : null}
        options={choiceOptions(field)}
        onChange={onCommit}
      />
    </div>
  );
}

function MultiCell({ field, value, onCommit }: CellProps) {
  return (
    <div className="py-0.5">
      <MultiDropdown
        values={Array.isArray(value) ? (value as string[]) : []}
        options={choiceOptions(field)}
        onChange={onCommit}
      />
    </div>
  );
}

export function CellEditor({ field, value, onCommit }: CellProps) {
  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onCommit(e.target.checked)}
        className="ml-2 size-4 accent-[var(--color-primary)]"
      />
    );
  }
  if (field.type === "number")
    return <NumberCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "rating")
    return <RatingCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "date")
    return <DateCell field={field} value={value} onCommit={onCommit} />;
  if (SELECT_LIKE.has(field.type))
    return <SelectCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "multi_select")
    return <MultiCell field={field} value={value} onCommit={onCommit} />;
  if (TEXT_TYPES.has(field.type))
    return <TextCell field={field} value={value} onCommit={onCommit} />;

  return <span className="px-2 text-sm text-muted-foreground">—</span>;
}
