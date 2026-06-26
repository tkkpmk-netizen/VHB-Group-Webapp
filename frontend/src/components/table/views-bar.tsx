"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Columns3,
  GanttChart,
  LayoutGrid,
  Plus,
  Table,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

type View = components["schemas"]["ViewOut"];
type ViewType = View["type"];

const TYPES: { value: ViewType; label: string; icon: typeof Table }[] = [
  { value: "table", label: "Table", icon: Table },
  { value: "board", label: "Board", icon: Columns3 },
  { value: "calendar", label: "Calendar", icon: Calendar },
  { value: "gallery", label: "Gallery", icon: LayoutGrid },
  { value: "gantt", label: "Timeline", icon: GanttChart },
];
const iconFor = (t: ViewType) => TYPES.find((x) => x.value === t)?.icon ?? Table;

export function ViewsBar({
  databaseId,
  views,
  activeId,
  setActiveId,
}: {
  databaseId: string;
  views: View[];
  activeId: string;
  setActiveId: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["views", databaseId] });

  const addView = useMutation({
    mutationFn: (type: ViewType) =>
      apiFetch<View>(`/databases/${databaseId}/views`, {
        method: "POST",
        body: JSON.stringify({
          name: TYPES.find((t) => t.value === type)?.label ?? "View",
          type,
          config: {},
        }),
      }),
    onSuccess: (v) => {
      setAdding(null);
      invalidate();
      setActiveId(v.id);
    },
  });

  const renameView = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<View>(`/views/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      setRenaming(null);
      invalidate();
    },
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/views/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      if (id === activeId) {
        const next = views.find((v) => v.id !== id);
        if (next) setActiveId(next.id);
      }
      invalidate();
    },
  });

  return (
    <div className="flex items-center gap-1 border-b">
      {views.map((v) => {
        const Icon = iconFor(v.type);
        const active = v.id === activeId;
        if (renaming?.id === v.id) {
          return (
            <input
              key={v.id}
              autoFocus
              value={renaming.name}
              onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
              onBlur={() =>
                renaming.name.trim()
                  ? renameView.mutate({ id: v.id, name: renaming.name.trim() })
                  : setRenaming(null)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="mb-[-1px] w-28 border-b-2 border-primary bg-transparent px-2 py-1.5 text-sm outline-none"
            />
          );
        }
        return (
          <button
            key={v.id}
            onClick={() => setActiveId(v.id)}
            onDoubleClick={() => setRenaming({ id: v.id, name: v.name })}
            className={`group mb-[-1px] flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-sm ${
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {v.name}
            {active && views.length > 1 && (
              <Trash2
                onClick={(e) => {
                  e.stopPropagation();
                  deleteView.mutate(v.id);
                }}
                className="size-3 opacity-0 hover:text-destructive group-hover:opacity-100"
              />
            )}
          </button>
        );
      })}
      <button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAdding({ x: r.left, y: r.bottom + 4 });
        }}
        title="Add view"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
      >
        <Plus className="size-4" />
      </button>

      {adding &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAdding(null)} />
            <div
              className="fixed z-50 w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
              style={{ top: adding.y, left: adding.x }}
            >
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => addView.mutate(t.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <t.icon className="size-4 text-muted-foreground" />
                  {t.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
