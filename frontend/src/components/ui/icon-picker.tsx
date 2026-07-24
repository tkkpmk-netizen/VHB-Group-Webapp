"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";

import { FaIcon } from "@/components/ui/fa-icon";

type IconManifestItem = {
  name: string;
  label: string;
  file: string;
};

type IconPickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  color?: string;
  onColorChange?: (color: string) => void;
  disabled?: boolean;
};

export const ICON_COLOR_PALETTE = [
  "#87909e",
  "#7b68ee",
  "#6f52ed",
  "#a855f7",
  "#d946ef",
  "#e84c7f",
  "#ef3826",
  "#f97316",
  "#f0a12a",
  "#2fb344",
  "#0ca678",
  "#0891b2",
  "#1264d7",
  "#0b8bd9",
] as const;

const COMMON_ICONS = [
  "layer-group",
  "folder.1",
  "database",
  "table",
  "columns",
  "th-list",
  "calendar-alt.1",
  "images.1",
  "stream",
  "file-alt",
  "user-friends",
  "project-diagram",
  "tasks",
  "chart-bar.1",
  "globe",
  "briefcase",
  "shipping-fast",
  "warehouse",
  "calculator",
  "coins",
  "tags",
  "star.1",
  "map-marker-alt",
  "paperclip",
];

export function IconPicker({
  value,
  onChange,
  label = "Choose icon",
  color = "var(--icon-database)",
  onColorChange,
  disabled = false,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [icons, setIcons] = useState<IconManifestItem[]>([]);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || icons.length > 0) return;
    let cancelled = false;
    fetch("/icons/fa5-solid/manifest.json")
      .then((response) => response.json() as Promise<IconManifestItem[]>)
      .then((items) => {
        if (!cancelled) setIcons(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [icons.length, open]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const visibleIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      const common = new Set(COMMON_ICONS);
      const featured = icons.filter((item) => common.has(item.name));
      return featured.length ? featured : COMMON_ICONS.map((name) => ({ name, label: name, file: `${name}.svg` }));
    }
    return icons
      .filter((item) => `${item.label} ${item.name}`.toLowerCase().includes(normalizedQuery))
      .slice(0, 144);
  }, [icons, query]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--text-secondary)] transition-colors hover:border-[var(--control-border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        title={label}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const rect = triggerRef.current?.getBoundingClientRect();
          if (!rect) return;
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 332)),
            top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 398)),
          });
          setOpen(true);
        }}
      >
        <FaIcon name={value || "circle"} className="size-4" style={{ color }} />
      </button>

      {position && typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? <motion.div
              ref={popupRef}
              role="dialog"
              aria-label={label}
              initial={{ opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{
                opacity: 0,
                y: -2,
                scale: 0.985,
                transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
              }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-[160] w-[320px] origin-top-left overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[var(--shadow-popover)]"
              style={position}
            >
              <div className="border-b border-[var(--border)] p-2.5">
                <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 focus-within:border-[var(--ring)] focus-within:ring-1 focus-within:ring-[var(--ring)]">
                  <FaIcon name="search" className="size-3.5 text-[var(--text-secondary)]" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-tertiary)]"
                    placeholder="Search 1,002 solid icons…"
                    aria-label="Search icons"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="Clear icon search"
                      className="inline-flex size-7 items-center justify-center rounded hover:bg-white"
                      onClick={() => setQuery("")}
                    >
                      <FaIcon name="times" className="size-3" />
                    </button>
                  ) : null}
                </div>
                {onColorChange ? (
                  <div className="mt-2 flex items-center gap-1.5 px-0.5" aria-label="Icon color">
                    {ICON_COLOR_PALETTE.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        aria-label={`Use icon color ${swatch}`}
                        aria-pressed={color.toLowerCase() === swatch}
                        onClick={() => onColorChange(swatch)}
                        className={`size-5 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                          color.toLowerCase() === swatch ? "border-white ring-2 ring-[var(--ring)]" : "border-white"
                        }`}
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="max-h-[320px] overflow-y-auto p-2.5">
                <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  {query ? `${visibleIcons.length} matches` : "Recommended"}
                </p>
                <div className="grid grid-cols-8 gap-1">
                  {visibleIcons.map((icon) => (
                    <button
                      key={icon.name}
                      type="button"
                      aria-label={icon.label}
                      aria-pressed={icon.name === value}
                      title={icon.label}
                      className={`inline-flex aspect-square items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                        icon.name === value
                          ? "bg-[var(--surface-selected)] text-[var(--accent-foreground)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                      }`}
                      onClick={() => {
                        onChange(icon.name);
                        setOpen(false);
                        triggerRef.current?.focus();
                      }}
                    >
                    <FaIcon name={icon.name} className="size-4" style={{ color }} />
                    </button>
                  ))}
                </div>
                {visibleIcons.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[var(--text-secondary)]">No solid icon found.</p>
                ) : null}
              </div>
              </motion.div> : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
