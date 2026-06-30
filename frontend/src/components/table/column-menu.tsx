"use client";

import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownAZ,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpAZ,
  Group as GroupIcon,
  ListFilter,
  Pin,
  Sigma,
  Trash2,
  WrapText,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { Dropdown } from "@/components/ui/dropdown";
import { FieldConfig } from "@/components/table/field-config";
import { operatorsFor, type FilterGroup, type SortRule } from "@/lib/view";
import type { components } from "@/lib/api/schema";

type Field = components["schemas"]["FieldOut"];
type CalcOption = { value: string; label: string };

export function ColumnMenu({
  field,
  databaseId,
  onClose,
  x,
  y,
  onInsert,
  frozen,
  onFreezeToggle,
  sorts,
  setSorts,
  groupFieldId,
  setGroupFieldId,
  filterRoot,
  setFilterRoot,
  calcValue,
  setCalc,
  calcOptions,
}: {
  field: Field;
  databaseId: string;
  onClose: () => void;
  x: number;
  y: number;
  onInsert: (side: "left" | "right") => void;
  frozen: boolean;
  onFreezeToggle: () => void;
  sorts: SortRule[];
  setSorts: (s: SortRule[]) => void;
  groupFieldId: string | null;
  setGroupFieldId: (id: string | null) => void;
  filterRoot: FilterGroup;
  setFilterRoot: (g: FilterGroup) => void;
  calcValue: string;
  setCalc: (v: string) => void;
  calcOptions: CalcOption[];
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => apiFetch<void>(`/fields/${field.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fields", databaseId] });
      onClose();
    },
  });
  const patchField = useMutation({
    mutationFn: (options: Record<string, unknown>) =>
      apiFetch<Field>(`/fields/${field.id}`, {
        method: "PATCH",
        body: JSON.stringify({ options }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fields", databaseId] }),
  });

  const sortDir = sorts.find((s) => s.fieldId === field.id)?.dir;
  const grouped = groupFieldId === field.id;
  const wrapped = !!(field.options as { wrap?: boolean })?.wrap;
  const setSort = (dir: "asc" | "desc") =>
    setSorts([
      { fieldId: field.id, dir },
      ...sorts.filter((s) => s.fieldId !== field.id),
    ]);
  const addFilter = () => {
    setFilterRoot({
      ...filterRoot,
      rules: [
        ...filterRoot.rules,
        { fieldId: field.id, op: operatorsFor(field.type)[0]?.value ?? "is", value: "" },
      ],
    });
    onClose();
  };

  const left =
    typeof window !== "undefined" ? Math.min(x, window.innerWidth - 300) : x;
  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted";
  const activeItem = "bg-primary/10 text-primary";
  return createPortal(
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className="fixed z-40 max-h-[80vh] w-72 overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
        style={{ top: y, left: Math.max(8, left) }}
      >
        {/* Quick actions */}
        <div className="mb-1 border-b pb-1">
          <button
            type="button"
            onClick={() => setSort("asc")}
            className={`${item} ${sortDir === "asc" ? activeItem : ""}`}
          >
            <ArrowUpAZ className="size-4" /> Sort ascending
          </button>
          <button
            type="button"
            onClick={() => setSort("desc")}
            className={`${item} ${sortDir === "desc" ? activeItem : ""}`}
          >
            <ArrowDownAZ className="size-4" /> Sort descending
          </button>
          <button
            type="button"
            onClick={() => setGroupFieldId(grouped ? null : field.id)}
            className={`${item} ${grouped ? activeItem : ""}`}
          >
            <GroupIcon className="size-4" /> {grouped ? "Remove grouping" : "Group by this field"}
          </button>
          <button type="button" onClick={addFilter} className={item}>
            <ListFilter className="size-4" /> Filter by this field
          </button>
          {field.type !== "unique_id" && (
            <button
              type="button"
              onClick={() => patchField.mutate({ ...field.options, wrap: !wrapped })}
              className={`${item} ${wrapped ? activeItem : ""}`}
            >
              <WrapText className="size-4" /> Wrap text
            </button>
          )}
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
            <span className="flex items-center gap-2">
              <Sigma className="size-4" /> Calculate
            </span>
            <div className="w-32">
              <Dropdown
                value={calcValue || null}
                placeholder="None"
                options={calcOptions}
                onChange={(v) => setCalc(v ?? "")}
              />
            </div>
          </div>
        </div>

        <FieldConfig field={field} databaseId={databaseId} />

        <div className="mt-1 border-t pt-1">
          <button
            type="button"
            onClick={() => {
              onFreezeToggle();
              onClose();
            }}
            className={item}
          >
            <Pin className="size-4" /> {frozen ? "Unfreeze" : "Freeze up to here"}
          </button>
          <button type="button" onClick={() => { onInsert("left"); onClose(); }} className={item}>
            <ArrowLeftToLine className="size-4" /> Insert left
          </button>
          <button type="button" onClick={() => { onInsert("right"); onClose(); }} className={item}>
            <ArrowRightToLine className="size-4" /> Insert right
          </button>
          <button
            type="button"
            onClick={() => del.mutate()}
            className={`${item} text-destructive`}
          >
            <Trash2 className="size-4" /> Delete column
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
