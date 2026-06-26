"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  EyeOff,
  Group as GroupIcon,
  ListFilter,
  Pin,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
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
  sortDir,
  grouped,
  onSort,
  onGroup,
  onFilter,
  onHide,
  calcValue,
  calcOptions,
  onCalc,
}: {
  field: Field;
  databaseId: string;
  onClose: () => void;
  x: number;
  y: number;
  onInsert: (side: "left" | "right") => void;
  frozen: boolean;
  onFreezeToggle: () => void;
  sortDir: "asc" | "desc" | null;
  grouped: boolean;
  onSort: (dir: "asc" | "desc") => void;
  onGroup: () => void;
  onFilter: () => void;
  onHide: () => void;
  calcValue: string;
  calcOptions: { value: string; label: string }[];
  onCalc: (v: string) => void;
}) {
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const del = useMutation({
    mutationFn: () => apiFetch<void>(`/fields/${field.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      onClose();
    },
  });

  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const left = vw ? Math.min(x, vw - 300) : x;
  const maxHeight = vh ? vh - y - 16 : undefined;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 w-72 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
        style={{ top: y, left: Math.max(8, left), maxHeight }}
      >
        {/* Quick Sort / Group / Filter by this field */}
        <div className="mb-1 border-b pb-1">
          <button
            type="button"
            onClick={() => {
              onSort("asc");
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
              sortDir === "asc" ? "text-primary" : ""
            }`}
          >
            <ArrowUp className="size-4" /> Sort ascending
          </button>
          <button
            type="button"
            onClick={() => {
              onSort("desc");
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
              sortDir === "desc" ? "text-primary" : ""
            }`}
          >
            <ArrowDown className="size-4" /> Sort descending
          </button>
          <button
            type="button"
            onClick={() => {
              onGroup();
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${
              grouped ? "text-primary" : ""
            }`}
          >
            <GroupIcon className="size-4" />
            {grouped ? "Remove grouping" : "Group by this field"}
          </button>
          <button
            type="button"
            onClick={() => {
              onFilter();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <ListFilter className="size-4" /> Filter by this field
          </button>
        </div>

        <FieldConfig field={field} databaseId={databaseId} />

        <div className="mt-1 border-t pt-1">
          <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
            <span className="text-muted-foreground">Calculate</span>
            <div className="ml-auto w-32">
              <Dropdown
                value={calcValue || null}
                allowClear={false}
                placeholder="None"
                options={calcOptions}
                onChange={(v) => onCalc(v ?? "")}
              />
            </div>
          </div>
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
            onClick={() => {
              onHide();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <EyeOff className="size-4" /> Hide column
          </button>
          {confirmDel ? (
            <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
              <span className="mr-auto text-muted-foreground">Delete column?</span>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="rounded px-2 py-0.5 hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => del.mutate()}
                className="rounded bg-destructive px-2 py-0.5 font-medium text-destructive-foreground hover:opacity-90"
              >
                Delete
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-muted"
            >
              <Trash2 className="size-4" /> Delete column
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
