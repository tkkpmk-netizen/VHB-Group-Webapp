"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Check, ChevronDown, Search, X } from "@/components/ui/fa-icon";
import { chipColor } from "@/lib/field-colors";

export type DropdownOption = {
  value: string;
  label: React.ReactNode;
  color?: string;
  /** Plain text used by searchable menus when the visual label is rich JSX. */
  searchText?: string;
};

type Pos = { x: number; y: number; w: number };

function OptionLabel({ option }: { option: DropdownOption }) {
  if (!option.color) return <span>{option.label}</span>;
  const c = chipColor(option.color);
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.fg }}
    >
      {option.label}
    </span>
  );
}

function Panel({
  pos,
  onClose,
  children,
}: {
  pos: Pos;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const left =
    typeof window !== "undefined"
      ? Math.min(pos.x, window.innerWidth - 220)
      : pos.x;
  return createPortal(
    <>
      {/* Dropdown panels are portalled to <body>. Keep them above dialogs
          (including the import mapping dialog at z-80), not behind them. */}
      <div className="fixed inset-0 z-[130]" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -2, scale: 0.99 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        ref={(node) => {
          if (node)
            queueMicrotask(() =>
              (node.querySelector<HTMLInputElement>("input[data-dropdown-search]") ??
                node.querySelector<HTMLButtonElement>("button"))?.focus(),
            );
        }}
        role="listbox"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
          );
          if (!buttons.length) return;
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : e.key === "ArrowDown"
                  ? Math.min(buttons.length - 1, Math.max(0, current + 1))
                  : Math.max(0, current < 0 ? 0 : current - 1);
          buttons[next]?.focus();
        }}
        className="fixed z-[140] max-h-64 origin-top overflow-auto rounded-lg border bg-popover p-1 text-xs leading-4 text-popover-foreground shadow-lg"
        style={{ top: pos.y, left: Math.max(8, left), minWidth: Math.max(pos.w, 160) }}
      >
        {children}
      </motion.div>
    </>,
    document.body,
  );
}

const triggerCls =
  "flex min-h-8 w-full items-center justify-between gap-1 rounded-md px-2 py-1 text-xs leading-4 hover:bg-accent/40 outline-none";
const compactTriggerCls =
  "flex h-6 w-full items-center justify-between gap-1 rounded-md border border-border/80 bg-background px-2 text-[11px] font-medium leading-none text-foreground shadow-[0_1px_1px_rgba(15,23,42,0.03)] hover:bg-muted outline-none";

function optionText(option: DropdownOption) {
  if (option.searchText) return option.searchText;
  return typeof option.label === "string" || typeof option.label === "number"
    ? String(option.label)
    : option.value;
}

function SearchField({
  query,
  onChange,
  placeholder,
}: {
  query: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="sticky top-0 z-10 mb-1 bg-popover p-1">
      <label className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        <Search className="size-3.5 shrink-0" />
        <input
          data-dropdown-search
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="flex size-6 items-center justify-center rounded hover:bg-muted"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </label>
    </div>
  );
}

/** Single-select custom dropdown (replaces native <select>). */
export function Dropdown({
  value,
  options,
  onChange,
  placeholder = "—",
  allowClear = true,
  autoOpen = false,
  wrap = false,
  trigger,
  searchable = false,
  searchPlaceholder = "Search options…",
  compact = false,
}: {
  value: string | null;
  options: DropdownOption[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  autoOpen?: boolean;
  wrap?: boolean;
  trigger?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, w: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) => optionText(option).toLocaleLowerCase().includes(needle))
      : options;
  }, [options, query]);

  function openMenu() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    setOpen(true);
    setQuery("");
  }
  // Callback ref: open once on mount when autoOpen (no effect → lint-safe).
  const setBtn = (el: HTMLButtonElement | null) => {
    ref.current = el;
    if (el && autoOpen && !opened.current) {
      opened.current = true;
      const r = el.getBoundingClientRect();
      setPos({ x: r.left, y: r.bottom + 4, w: r.width });
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={setBtn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openMenu}
        className={compact ? compactTriggerCls : triggerCls}
      >
        <span className={wrap ? "break-words" : "truncate"}>
          {trigger ??
            (current ? (
              <OptionLabel option={current} />
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            ))}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <Panel
          pos={pos}
          onClose={() => {
            setOpen(false);
            queueMicrotask(() => ref.current?.focus());
          }}
        >
          {searchable ? (
            <SearchField
              query={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
            />
          ) : null}
          {allowClear && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex min-h-7 w-full items-center rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-accent focus:bg-accent"
            >
              —
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex min-h-7 w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs outline-none hover:bg-accent focus:bg-accent"
            >
              <OptionLabel option={o} />
              {value === o.value && <Check className="size-3.5" />}
            </button>
          ))}
          {filtered.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching options. Try another keyword.
            </p>
          ) : null}
        </Panel>
      )}
    </>
  );
}

/** Multi-select custom dropdown — chips in trigger, toggle in popover. */
export function MultiDropdown({
  values,
  options,
  onChange,
  placeholder = "—",
  autoOpen = false,
  wrap = true,
  searchable = false,
  searchPlaceholder = "Search options…",
}: {
  values: string[];
  options: DropdownOption[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  autoOpen?: boolean;
  wrap?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, w: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.filter((o) => values.includes(o.value));
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) => optionText(option).toLocaleLowerCase().includes(needle))
      : options;
  }, [options, query]);

  function openMenu() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    setOpen(true);
    setQuery("");
  }
  const setBtn = (el: HTMLButtonElement | null) => {
    ref.current = el;
    if (el && autoOpen && !opened.current) {
      opened.current = true;
      const r = el.getBoundingClientRect();
      setPos({ x: r.left, y: r.bottom + 4, w: r.width });
      setOpen(true);
    }
  };

  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  }

  return (
    <>
      <button
        ref={setBtn}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={openMenu}
        className={triggerCls}
      >
        <span
          className={`flex items-center gap-1 ${
            wrap ? "flex-wrap" : "overflow-hidden"
          }`}
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            selected.map((o) => <OptionLabel key={o.value} option={o} />)
          )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <Panel
          pos={pos}
          onClose={() => {
            setOpen(false);
            queueMicrotask(() => ref.current?.focus());
          }}
        >
          {searchable ? (
            <SearchField
              query={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
            />
          ) : null}
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No options
            </p>
          )}
          {filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className="flex min-h-7 w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs outline-none hover:bg-accent focus:bg-accent"
            >
              <OptionLabel option={o} />
              {values.includes(o.value) && <Check className="size-3.5" />}
            </button>
          ))}
          {options.length > 0 && filtered.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching options. Try another keyword.
            </p>
          ) : null}
        </Panel>
      )}
    </>
  );
}
