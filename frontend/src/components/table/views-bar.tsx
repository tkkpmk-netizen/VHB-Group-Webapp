"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Check,
  Copy,
  Columns3,
  GanttChart,
  LayoutGrid,
  List,
  Plus,
  Table,
  Trash2,
  FaIcon,
} from "@/components/ui/fa-icon";
import { IconPicker } from "@/components/ui/icon-picker";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { iconForLayout, LAYOUT_ICONS } from "@/lib/icon-system";

type Layout = components["schemas"]["LayoutOut"];
type LayoutType = Layout["type"];

const TYPES: { value: LayoutType; label: string; icon: typeof Table }[] = [
  { value: "table", label: "Table", icon: Table },
  { value: "board", label: "Board", icon: Columns3 },
  { value: "list", label: "List", icon: List },
  { value: "calendar", label: "Calendar", icon: Calendar },
  { value: "gallery", label: "Gallery", icon: LayoutGrid },
  { value: "gantt", label: "Timeline", icon: GanttChart },
];
const shortcutFor: Partial<Record<LayoutType, string>> = {
  table: "T",
  board: "B",
  list: "L",
  calendar: "C",
  gallery: "G",
  gantt: "Y",
};

export function ViewsBar({
  databaseId,
  placementId,
  views,
  activeId,
  setActiveId,
}: {
  databaseId: string;
  placementId?: string;
  views: Layout[];
  activeId: string;
  setActiveId: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{
    id: string;
    name: string;
    icon: string;
    iconColor: string;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ layout: Layout; x: number; y: number } | null>(null);
  const [localViews, setLocalViews] = useState<{ base: Layout[]; value: Layout[] }>({
    base: views,
    value: views,
  });
  const orderedViews = localViews.base === views ? localViews.value : views;
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["layouts", databaseId, placementId ?? "canonical"] });

  // Drag-reorder tabs: PATCH each layout's `order` to its new index.
  const patchOrder = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map((id, i) =>
          apiFetch<Layout>(`/layouts/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ order: i }),
          }),
        ),
      ),
    onSuccess: invalidate,
  });
  function moveLayout(fromId: string, toId: string) {
    if (fromId === toId) return;
    const ids = orderedViews.map((v) => v.id).filter((i) => i !== fromId);
    ids.splice(ids.indexOf(toId), 0, fromId);
    setLocalViews({
      base: views,
      value: ids.map((id) => orderedViews.find((view) => view.id === id)!),
    });
    patchOrder.mutate(ids);
  }

  const addLayout = useMutation({
    mutationFn: (type: LayoutType) =>
      apiFetch<Layout>(
        `/databases/${databaseId}/layouts${placementId ? `?placement_id=${placementId}` : ""}`,
        {
        method: "POST",
        body: JSON.stringify({
          name: TYPES.find((t) => t.value === type)?.label ?? "Layout",
          type,
          icon: LAYOUT_ICONS[type],
          config: {},
        }),
        },
      ),
    onSuccess: (v) => {
      setAdding(null);
      invalidate();
      setActiveId(v.id);
    },
  });

  const renameLayout = useMutation({
    mutationFn: ({ id, name, icon, iconColor }: { id: string; name: string; icon: string; iconColor: string }) =>
      apiFetch<Layout>(`/layouts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, icon, icon_color: iconColor }),
      }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
    },
  });
  const duplicateLayout = useMutation({
    mutationFn: (layout: Layout) =>
      apiFetch<Layout>(
        `/databases/${databaseId}/layouts${placementId ? `?placement_id=${placementId}` : ""}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: `${layout.name} copy`,
            type: layout.type,
            icon: layout.icon,
            icon_color: layout.icon_color,
            config: layout.config,
          }),
        },
      ),
    onSuccess: (created) => {
      setMenu(null);
      invalidate();
      setActiveId(created.id);
    },
  });
  const deleteLayout = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/layouts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setMenu(null);
      invalidate();
    },
  });
  const setPinned = useMutation({
    mutationFn: ({ layout, pinned }: { layout: Layout; pinned: boolean }) =>
      apiFetch<Layout>(`/layouts/${layout.id}`, {
        method: "PATCH",
        body: JSON.stringify({ config: { ...(layout.config ?? {}), pinned_to_space: pinned } }),
      }),
    onSuccess: () => {
      setMenu(null);
      invalidate();
    },
  });

  return (
    <div className="flex w-max items-center gap-1 whitespace-nowrap">
      {orderedViews.map((v) => {
        const active = v.id === activeId;
        if (renaming?.id === v.id) {
          return (
            <div
              key={v.id}
              className="mb-[-1px] flex h-7 items-center gap-1 border-b-2 border-primary px-1"
            >
              <IconPicker
                value={renaming.icon}
                onChange={(icon) => setRenaming((current) => current ? { ...current, icon } : current)}
                onColorChange={(iconColor) => setRenaming((current) => current ? { ...current, iconColor } : current)}
                label={`Choose icon for ${v.name}`}
                color={renaming.iconColor}
              />
              <input
                autoFocus
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && renaming.name.trim()) {
                    renameLayout.mutate({ ...renaming, name: renaming.name.trim() });
                  }
                  if (e.key === "Escape") setRenaming(null);
                }}
                className="w-24 bg-transparent px-1 text-xs outline-none"
              />
              <button
                type="button"
                aria-label="Save layout name and icon"
                className="flex size-6 items-center justify-center rounded hover:bg-muted"
                onClick={() =>
                  renaming.name.trim() &&
                  renameLayout.mutate({ ...renaming, name: renaming.name.trim() })
                }
              >
                <Check className="size-3.5" />
              </button>
            </div>
          );
        }
        return (
          <div
            key={v.id}
            draggable
            onDragStart={() => setDragId(v.id)}
            onDragEnd={() => setDragId(null)}
            onDragEnter={(e) => {
              // Tabs only accept a drop from another tab; dragging outside
              // this strip cannot change the saved layout order.
              if (dragId) {
                e.preventDefault();
                moveLayout(dragId, v.id);
              }
            }}
            onDragOver={(e) => dragId && e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ layout: v, x: event.clientX, y: event.clientY });
            }}
            className={`mb-[-1px] flex h-7 cursor-grab items-center gap-1 rounded-t-md border-b-2 px-1.5 text-xs active:cursor-grabbing ${
              active
                ? "border-primary bg-primary/5 font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveId(v.id)}
              onDoubleClick={() =>
                setRenaming({
                  id: v.id,
                  name: v.name,
                  icon: iconForLayout(v),
                  iconColor: v.icon_color || `var(--icon-layout-${v.type === "gantt" ? "gantt" : v.type})`,
                })
              }
              title={`Open · double-click to rename · drag to reorder${shortcutFor[v.type] ? ` · ${shortcutFor[v.type]}` : ""}`}
              className="flex min-w-0 items-center gap-1.5 px-0.5"
            >
              <FaIcon
                name={iconForLayout(v)}
                className="size-3"
                style={{ color: v.icon_color || `var(--icon-layout-${v.type === "gantt" ? "gantt" : v.type})` }}
              />
              <span className="max-w-36 truncate">{v.name}</span>
            </button>
          </div>
        );
      })}
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAdding({ x: r.left, y: r.bottom + 4 });
        }}
        title="Add layout"
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-3.5" />
      </button>

      {adding &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[80]" onClick={() => setAdding(null)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-[90] w-44 origin-top rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: adding.y, left: adding.x }}
            >
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => addLayout.mutate(t.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <t.icon className="size-4 text-muted-foreground" />
                  {t.label}
                </button>
              ))}
            </motion.div>
          </>,
          document.body,
        )}
      {menu &&
        createPortal(
          <>
            <button type="button" aria-label="Close layout menu" className="fixed inset-0 z-[80] cursor-default" onClick={() => setMenu(null)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-[90] w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: menu.y, left: Math.max(8, Math.min(menu.x, window.innerWidth - 200)) }}
            >
              <button
                type="button"
                onClick={() => {
                  setRenaming({ id: menu.layout.id, name: menu.layout.name, icon: iconForLayout(menu.layout), iconColor: menu.layout.icon_color || "#1264d7" });
                  setMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <FaIcon name="pen" className="size-3.5" /> Rename & icon
              </button>
              <button type="button" onClick={() => duplicateLayout.mutate(menu.layout)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <Copy className="size-3.5" /> Duplicate
              </button>
              {placementId ? (
                <button type="button" onClick={() => setPinned.mutate({ layout: menu.layout, pinned: !(menu.layout.config as { pinned_to_space?: boolean } | null)?.pinned_to_space })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <FaIcon name="thumbtack" className="size-3.5" /> {(menu.layout.config as { pinned_to_space?: boolean } | null)?.pinned_to_space ? "Unpin from Space" : "Pin to Space"}
                </button>
              ) : null}
              <div className="my-1 border-t" />
              <button
                type="button"
                disabled={orderedViews.length <= 1 || deleteLayout.isPending}
                onClick={() => deleteLayout.mutate(menu.layout.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" /> Delete layout
              </button>
            </motion.div>
          </>,
          document.body,
        )}
    </div>
  );
}
