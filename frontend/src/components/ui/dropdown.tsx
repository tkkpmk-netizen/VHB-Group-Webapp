"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { chipColor } from "@/lib/field-colors";

export type DropdownOption = {
  value: string;
  label: React.ReactNode;
  color?: string;
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
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 max-h-64 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        style={{ top: pos.y, left: Math.max(8, left), minWidth: Math.max(pos.w, 160) }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

const triggerCls =
  "flex w-full items-center justify-between gap-1 rounded px-2 py-1.5 text-sm hover:bg-accent/40 outline-none";

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
}: {
  value: string | null;
  options: DropdownOption[];
  onChange: (v: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  autoOpen?: boolean;
  wrap?: boolean;
  trigger?: React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, w: 0 });
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? null;

  function openMenu() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    setOpen(true);
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
      <button ref={setBtn} type="button" onClick={openMenu} className={triggerCls}>
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
        <Panel pos={pos} onClose={() => setOpen(false)}>
          {allowClear && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              —
            </button>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <OptionLabel option={o} />
              {value === o.value && <Check className="size-3.5" />}
            </button>
          ))}
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
}: {
  values: string[];
  options: DropdownOption[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  autoOpen?: boolean;
  wrap?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0, w: 0 });
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => values.includes(o.value));

  function openMenu() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    setOpen(true);
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
      <button ref={setBtn} type="button" onClick={openMenu} className={triggerCls}>
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
        <Panel pos={pos} onClose={() => setOpen(false)}>
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No options
            </p>
          )}
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggle(o.value)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <OptionLabel option={o} />
              {values.includes(o.value) && <Check className="size-3.5" />}
            </button>
          ))}
        </Panel>
      )}
    </>
  );
}
