"use client";

import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Pin,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { FieldConfig } from "@/components/table/field-config";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];

export function ColumnMenu({
  field,
  databaseId,
  onClose,
  x,
  y,
  onInsert,
  frozen,
  onFreezeToggle,
}: {
  field: Field;
  databaseId: string;
  onClose: () => void;
  x: number;
  y: number;
  onInsert: (side: "left" | "right") => void;
  frozen: boolean;
  onFreezeToggle: () => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => apiFetch<void>(`/fields/${field.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      onClose();
    },
  });

  const left =
    typeof window !== "undefined" ? Math.min(x, window.innerWidth - 300) : x;
  return createPortal(
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="fixed z-40 max-h-[80vh] w-72 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
        style={{ top: y, left: Math.max(8, left) }}
      >
        <FieldConfig field={field} databaseId={databaseId} />

        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={() => {
              onFreezeToggle();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Pin className="size-4" /> {frozen ? "Unfreeze" : "Freeze up to here"}
          </button>
          <button
            type="button"
            onClick={() => {
              onInsert("left");
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <ArrowLeftToLine className="size-4" /> Insert left
          </button>
          <button
            type="button"
            onClick={() => {
              onInsert("right");
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <ArrowRightToLine className="size-4" /> Insert right
          </button>
          <button
            type="button"
            onClick={() => del.mutate()}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-muted"
          >
            <Trash2 className="size-4" /> Delete column
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
