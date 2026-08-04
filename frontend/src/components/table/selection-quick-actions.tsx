"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ChevronDown, FaIcon } from "@/components/ui/fa-icon";
import type { components } from "@/lib/api/schema";

type Entity = components["schemas"]["EntityOut"];
type Field = components["schemas"]["FieldOut"];

const DRAFT_KEY = "vhb:order-list:selected-products";

function fieldByName(fields: Field[], names: string[]) {
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  return fields.find((field) => accepted.has(field.name.trim().toLowerCase()));
}

function textValue(entity: Entity, field?: Field) {
  if (!field) return "";
  const value = (entity.data as Record<string, unknown>)[field.id];
  return value == null ? "" : String(value);
}

export function SelectionQuickActions({
  entities,
  fields,
}: {
  entities: Entity[];
  fields: Field[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (entities.length < 2) return null;

  const createOrderList = () => {
    const sku = fieldByName(fields, ["sku", "product sku"]);
    const packing = fieldByName(fields, ["packing", "packaging", "pack size"]);
    const unit = fieldByName(fields, ["base unit", "unit", "uom"]);
    const draft = entities.map((entity) => ({
      entity_id: entity.id,
      sku: textValue(entity, sku),
      product_name: entity.name,
      packing: textValue(entity, packing),
      quantity: 1,
      unit: textValue(entity, unit) || "CTN",
      unit_price: 0,
    }));
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    router.push("/order-management?tab=render&source=products");
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex h-6 items-center gap-1.5 rounded-md bg-primary px-2 text-[10px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
      >
        <FaIcon name="bolt" className="size-3" />
        {entities.length} selected
        <ChevronDown className="size-2.5" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close selection actions"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40"
          />
          <div
            role="menu"
            className="absolute right-0 top-7 z-50 w-56 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              onClick={createOrderList}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium hover:bg-muted"
            >
              <FaIcon name="file-excel.1" className="size-3.5 text-emerald-600" />
              <span className="min-w-0 flex-1">Create Order List</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled
              title="Inquiry module will be added in a later tranche"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground opacity-60"
            >
              <FaIcon name="clipboard-list" className="size-3.5" />
              <span className="min-w-0 flex-1">Create Inquiry</span>
              <span className="text-[9px] font-medium uppercase">Soon</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
