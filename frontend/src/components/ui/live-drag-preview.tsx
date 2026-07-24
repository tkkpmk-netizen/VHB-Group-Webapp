"use client";

import { useEffect } from "react";

/**
 * Keeps the source in place while a compact, native drag ghost follows the
 * pointer. This gives tree and layout drag the same physical feedback.
 */
export function LiveDragPreview() {
  useEffect(() => {
    let source: HTMLElement | null = null;
    let ghost: HTMLElement | null = null;

    const clear = () => {
      source?.removeAttribute("data-live-drag-source");
      ghost?.remove();
      ghost = null;
      source = null;
    };
    const start = (event: globalThis.DragEvent) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[draggable='true']")
        : null;
      if (!target || !event.dataTransfer) return;
      clear();
      source = target;
      source.dataset.liveDragSource = "true";
      ghost = target.cloneNode(true) as HTMLElement;
      ghost.style.cssText = `position:fixed;left:-1000px;top:-1000px;width:${Math.max(target.clientWidth, 144)}px;opacity:.92;pointer-events:none;border-radius:6px;background:var(--popover);box-shadow:0 10px 28px rgba(17,24,39,.22);`;
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 18, 14);
    };
    document.addEventListener("dragstart", start, true);
    document.addEventListener("drop", clear, true);
    document.addEventListener("dragend", clear, true);
    return () => {
      document.removeEventListener("dragstart", start, true);
      document.removeEventListener("drop", clear, true);
      document.removeEventListener("dragend", clear, true);
      clear();
    };
  }, []);

  return null;
}
