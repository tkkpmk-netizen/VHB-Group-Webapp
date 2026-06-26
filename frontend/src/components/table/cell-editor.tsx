"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Star } from "lucide-react";
import { Dropdown, MultiDropdown } from "@/components/ui/dropdown";
import { apiFetch } from "@/lib/api/client";
import { chipColor } from "@/lib/field-colors";
import {
  COUNTRY_OPTIONS,
  countryByCode,
  DIAL_OPTIONS,
  flagEmoji,
  parsePhone,
} from "@/lib/countries";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type RowT = components["schemas"]["RowOut"];
type Member = components["schemas"]["MemberOut"];

/** Workspace members (deduped by React Query across all People/By cells). */
function useMembers() {
  return useQuery<Member[]>({
    queryKey: ["members"],
    queryFn: () => apiFetch<Member[]>("/workspaces/me/members"),
  });
}

const memberLabel = (m: Member) => m.full_name || m.email;

/** Relation option label: ID (dimmed) + name (bold). */
function RelationLabel({
  row,
  idField,
  titleField,
}: {
  row: RowT;
  idField?: Field;
  titleField?: Field;
}) {
  const prefix = (idField?.options as { prefix?: string })?.prefix ?? "";
  const id = idField ? `${prefix}${row.seq}` : `#${row.seq}`;
  const nameVal = titleField
    ? (row.data as Record<string, unknown>)[titleField.id]
    : "";
  const name = typeof nameVal === "string" && nameVal ? nameVal : "Untitled";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{id}</span>
      <span className="font-semibold">{name}</span>
    </span>
  );
}
type Choice = { id: string; label: string; color?: string; group?: string };

/** Rich display of a value (flag for country, colored badge for select) —
 *  used for group headers so they match the cell appearance. */
export function ValueChip({ field, value }: { field: Field; value: unknown }) {
  if (value == null || value === "")
    return <span className="text-muted-foreground">Empty</span>;
  const t = field.type;
  if (t === "country") {
    const c = countryByCode(String(value));
    return (
      <span>
        {flagEmoji(String(value))} {c?.name ?? String(value)}
      </span>
    );
  }
  if (["select", "status", "priority"].includes(t)) {
    const raw = (field.options as { choices?: Choice[] })?.choices ?? [];
    const ch = raw.find((c) => c.id === value);
    if (ch) {
      const col = chipColor(ch.color);
      return (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: col.bg, color: col.fg }}
        >
          {ch.label}
        </span>
      );
    }
  }
  return <span>{String(value)}</span>;
}

function choiceOptions(field: Field) {
  const raw = (field.options as { choices?: Choice[] })?.choices;
  return (Array.isArray(raw) ? raw : []).map((c) => ({
    value: c.id,
    label: c.label,
    color: c.color,
  }));
}

const SELECT_LIKE = new Set(["select", "status", "priority"]);
const TEXT_TYPES = new Set(["text", "long_text", "email", "url"]);

const inputCls =
  "w-full select-text rounded bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-accent/40";
const isWrap = (field: Field) =>
  (field.options as { wrap?: boolean })?.wrap === true;
// Display container: truncates to one line unless the column has Wrap text on.
const displayCls = (field: Field) =>
  `min-h-[34px] cursor-text px-2 py-1.5 text-sm ${
    isWrap(field) ? "whitespace-pre-wrap break-words" : "truncate"
  }`;
const dash = <span className="text-muted-foreground">—</span>;

type CellProps = {
  field: Field;
  value: unknown;
  onCommit: (value: unknown) => void;
  /** When the cell is double-click-activated, text/number/phone open their input. */
  autoEdit?: boolean;
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

type DateValue = { start: string; end: string | null };

function parseDateValue(v: unknown): DateValue {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as { start?: string; end?: string | null };
    return { start: o.start ?? "", end: o.end ?? null };
  }
  if (typeof v === "string") return { start: v, end: null };
  return { start: "", end: null };
}

/** Format a single ISO date/datetime string per the column's date_format. */
function formatOne(field: Field, s: string): string {
  const fmt = (field.options as { date_format?: string })?.date_format ?? "iso";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return s;
  const [, y, mo, d, hh, mm] = m;
  let out =
    fmt === "dmy"
      ? `${d}/${mo}/${y}`
      : fmt === "mdy"
        ? `${mo}/${d}/${y}`
        : fmt === "ymd"
          ? `${y}/${mo}/${d}`
          : `${y}-${mo}-${d}`;
  if (hh != null && mm != null) out += ` ${hh}:${mm}`;
  return out;
}

function TextCell({ field, value, onCommit, autoEdit }: CellProps) {
  // autoEdit cells remount via key when activated, so initial state is enough.
  const [editing, setEditing] = useState(autoEdit ?? false);
  const [local, setLocal] = useState(
    autoEdit && typeof value === "string" ? value : "",
  );
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
        className={`flex-1 ${displayCls(field)}`}
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

function NumberCell({ field, value, onCommit, autoEdit }: CellProps) {
  const [editing, setEditing] = useState(autoEdit ?? false);
  const [local, setLocal] = useState(
    autoEdit && value != null ? String(value) : "",
  );
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
      className={displayCls(field)}
    >
      {displayNumber(field, value) || dash}
    </div>
  );
}

function DateCell({ field, value, onCommit }: CellProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState<string | null>(null);
  const [withTime, setWithTime] = useState(false);
  const [withEnd, setWithEnd] = useState(false);

  const norm = parseDateValue(value);

  function openEditor(e: React.MouseEvent) {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 4 });
    const n = parseDateValue(value);
    setStart(n.start);
    setEnd(n.end);
    setWithTime(n.start.includes("T") || (n.end?.includes("T") ?? false));
    setWithEnd(n.end != null);
    setOpen(true);
  }

  function emit(ns: string, ne: string | null, t: boolean, hasEnd: boolean) {
    const fix = (s: string) =>
      !s ? "" : t ? (s.includes("T") ? s : `${s.slice(0, 10)}T00:00`) : s.slice(0, 10);
    const fstart = fix(ns);
    if (!fstart) {
      onCommit(null);
      return;
    }
    onCommit({ start: fstart, end: hasEnd ? fix(ne || ns) : null });
  }

  const inputType = withTime ? "datetime-local" : "date";
  const toInput = (s: string | null) =>
    !s ? "" : withTime && !s.includes("T") ? `${s.slice(0, 10)}T00:00` : s;

  return (
    <>
      <div onClick={openEditor} className={`${displayCls(field)} cursor-pointer`}>
        {norm.start
          ? formatOne(field, norm.start) +
            (norm.end ? ` → ${formatOne(field, norm.end)}` : "")
          : dash}
      </div>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 w-64 space-y-2 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
              style={{
                top: pos.y,
                left:
                  typeof window !== "undefined"
                    ? Math.min(pos.x, window.innerWidth - 280)
                    : pos.x,
              }}
            >
              <input
                type={inputType}
                value={toInput(start)}
                onChange={(e) => {
                  setStart(e.target.value);
                  emit(e.target.value, end, withTime, withEnd);
                }}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              {withEnd && (
                <input
                  type={inputType}
                  value={toInput(end)}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    emit(start, e.target.value, withTime, true);
                  }}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={withTime}
                  onChange={(e) => {
                    setWithTime(e.target.checked);
                    emit(start, end, e.target.checked, withEnd);
                  }}
                  className="size-4 accent-[var(--color-primary)]"
                />
                Include time
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={withEnd}
                  onChange={(e) => {
                    setWithEnd(e.target.checked);
                    emit(start, end, withTime, e.target.checked);
                  }}
                  className="size-4 accent-[var(--color-primary)]"
                />
                End date
              </label>
            </div>
          </>,
          document.body,
        )}
    </>
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

function PhoneCell({ field, value, onCommit, autoEdit }: CellProps) {
  const [editing, setEditing] = useState(autoEdit ?? false);
  const parsed = parsePhone(typeof value === "string" ? value : "");
  const [dial, setDial] = useState(parsed.dial);
  const [num, setNum] = useState(parsed.number);

  function join(d: string, n: string): string | null {
    const v = `${d ? d + " " : ""}${n}`.trim();
    return v || null;
  }

  if (!editing) {
    const shown = `${parsed.dial} ${parsed.number}`.trim();
    return (
      <div
        onClick={() => {
          const p = parsePhone(typeof value === "string" ? value : "");
          setDial(p.dial);
          setNum(p.number);
          setEditing(true);
        }}
        className={displayCls(field)}
      >
        {shown || dash}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      <div className="w-24 shrink-0">
        <Dropdown
          value={dial || null}
          allowClear={false}
          placeholder="+code"
          options={DIAL_OPTIONS}
          onChange={(v) => {
            setDial(v || "");
            onCommit(join(v || "", num));
          }}
        />
      </div>
      <input
        autoFocus
        type="tel"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        onBlur={() => {
          let d = dial;
          let n = num.trim();
          if (n.startsWith("+") || !dial) {
            const p = parsePhone(n);
            if (p.dial) {
              d = p.dial;
              n = p.number;
            }
          }
          setDial(d);
          setNum(n);
          onCommit(join(d, n));
          setEditing(false);
        }}
        className={inputCls}
      />
    </div>
  );
}

function CountryCell({ field, value, onCommit, autoEdit }: CellProps) {
  return (
    <div className="py-0.5">
      <Dropdown
        value={typeof value === "string" ? value : null}
        options={COUNTRY_OPTIONS}
        onChange={onCommit}
        autoOpen={autoEdit}
        wrap={isWrap(field)}
      />
    </div>
  );
}

function RelationCell({ field, value, onCommit, autoEdit }: CellProps) {
  const targetDb = (field.options as { target_database_id?: string })
    ?.target_database_id;
  const rowsQ = useQuery<RowT[]>({
    queryKey: ["rows", targetDb],
    queryFn: () => apiFetch<RowT[]>(`/databases/${targetDb}/rows`),
    enabled: !!targetDb,
  });
  const fieldsQ = useQuery<Field[]>({
    queryKey: ["fields", targetDb],
    queryFn: () => apiFetch<Field[]>(`/databases/${targetDb}/fields`),
    enabled: !!targetDb,
  });
  const tFields = fieldsQ.data ?? [];
  const idField = tFields.find((f) => f.type === "unique_id");
  const titleField = tFields.find((f) =>
    ["text", "long_text"].includes(f.type),
  );
  const options = (rowsQ.data ?? []).map((r) => ({
    value: r.id,
    label: <RelationLabel row={r} idField={idField} titleField={titleField} />,
  }));
  return (
    <div className="py-0.5">
      <MultiDropdown
        values={Array.isArray(value) ? (value as string[]) : []}
        options={options}
        onChange={onCommit}
        placeholder="Link rows"
        autoOpen={autoEdit}
        wrap={isWrap(field)}
      />
    </div>
  );
}

function RollupCell({ field, value }: CellProps) {
  const text =
    value === null || value === undefined || value === ""
      ? ""
      : Array.isArray(value)
        ? value.join(", ")
        : String(value);
  return (
    <div className={`${displayCls(field)} font-medium`}>{text || dash}</div>
  );
}

function SelectCell({ field, value, onCommit, autoEdit }: CellProps) {
  return (
    <div className="py-0.5">
      <Dropdown
        value={typeof value === "string" ? value : null}
        options={choiceOptions(field)}
        onChange={onCommit}
        autoOpen={autoEdit}
        wrap={isWrap(field)}
      />
    </div>
  );
}

function MultiCell({ field, value, onCommit, autoEdit }: CellProps) {
  return (
    <div className="py-0.5">
      <MultiDropdown
        values={Array.isArray(value) ? (value as string[]) : []}
        options={choiceOptions(field)}
        onChange={onCommit}
        autoOpen={autoEdit}
        wrap={isWrap(field)}
      />
    </div>
  );
}

function PeopleCell({ field, value, onCommit }: CellProps) {
  const { data: members = [] } = useMembers();
  const options = members.map((m) => ({ value: m.id, label: memberLabel(m) }));
  return (
    <div className="py-0.5">
      <MultiDropdown
        values={Array.isArray(value) ? (value as string[]) : []}
        options={options}
        onChange={onCommit}
        placeholder="Assign people"
        wrap={isWrap(field)}
      />
    </div>
  );
}

/** Read-only creator/editor name (created_by, last_edited_by). */
function UserCell({ field, value }: CellProps) {
  const { data: members = [] } = useMembers();
  if (!value) return <div className={displayCls(field)}>{dash}</div>;
  const m = members.find((x) => x.id === value);
  return <div className={displayCls(field)}>{m ? memberLabel(m) : String(value)}</div>;
}

/** Read-only timestamp (created_time, last_edited_time). */
function TimeCell({ field, value }: CellProps) {
  if (!value || typeof value !== "string")
    return <div className={displayCls(field)}>{dash}</div>;
  const d = new Date(value);
  const text = Number.isNaN(d.getTime()) ? value : d.toLocaleString();
  return (
    <div className={`${displayCls(field)} text-muted-foreground`}>{text}</div>
  );
}

function ProgressCell({ value, onCommit, autoEdit }: CellProps) {
  const [editing, setEditing] = useState(autoEdit ?? false);
  const [local, setLocal] = useState(
    autoEdit && value != null ? String(value) : "",
  );
  const n = typeof value === "number" ? value : 0;
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        inputMode="numeric"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const x = Number(local);
          onCommit(
            local === "" || Number.isNaN(x) ? null : Math.max(0, Math.min(100, x)),
          );
        }}
        className={inputCls}
      />
    );
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${n}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
        {n}%
      </span>
    </div>
  );
}

export function CellEditor({ field, value, onCommit, autoEdit }: CellProps) {
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
    return (
      <NumberCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "rating")
    return <RatingCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "date")
    return <DateCell field={field} value={value} onCommit={onCommit} />;
  if (SELECT_LIKE.has(field.type))
    return (
      <SelectCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "multi_select")
    return (
      <MultiCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "phone")
    return (
      <PhoneCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "country")
    return (
      <CountryCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "relation")
    return (
      <RelationCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "rollup" || field.type === "formula")
    return <RollupCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "people")
    return <PeopleCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "progress")
    return (
      <ProgressCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );
  if (field.type === "created_time" || field.type === "last_edited_time")
    return <TimeCell field={field} value={value} onCommit={onCommit} />;
  if (field.type === "created_by" || field.type === "last_edited_by")
    return <UserCell field={field} value={value} onCommit={onCommit} />;
  if (TEXT_TYPES.has(field.type))
    return (
      <TextCell field={field} value={value} onCommit={onCommit} autoEdit={autoEdit} />
    );

  return <span className="px-2 text-sm text-muted-foreground">—</span>;
}
