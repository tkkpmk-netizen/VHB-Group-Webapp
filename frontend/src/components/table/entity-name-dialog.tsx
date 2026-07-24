"use client";

import { createPortal } from "react-dom";
import { useState } from "react";

/** A shared, explicit Name gate for every layout's create action. */
export function EntityNameDialog({
  open,
  onClose,
  onCreate,
  pending = false,
  label = "New entity",
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  pending?: boolean;
  label?: string;
}) {
  const [name, setName] = useState("");
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/25 p-4 pt-[18vh]">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={onClose} />
      <form
        className="relative z-10 w-full max-w-sm rounded-xl border bg-card p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          const value = name.trim();
          if (value) onCreate(value);
        }}
      >
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Name is required. UID is generated automatically.</p>
        <input
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Entity name"
          className="mt-4 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || pending}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create entity"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
