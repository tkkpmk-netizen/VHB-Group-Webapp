import {
  DRAG_CANCEL_EVENT,
  DRAG_END_EVENT,
  DRAG_START_EVENT,
} from "@/lib/drag-preview";
import { useEffect } from "react";

function makeTransparentDragImage() {
  const image = document.createElement("canvas");
  image.width = 1;
  image.height = 1;
  image.setAttribute("aria-hidden", "true");
  image.style.cssText =
    "position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none;";
  document.body.appendChild(image);
  return image;
}

/**
 * Owns the global drag lifecycle without drawing a cursor-following ghost.
 * The transparent native image keeps Chromium from snapshotting an entire
 * table or tree while each destination renders its own in-place preview.
 */
export function LiveDragPreview() {
  useEffect(() => {
    let source: HTMLElement | null = null;
    let nativeImage: HTMLCanvasElement | null = null;

    const clear = () => {
      source?.removeAttribute("data-live-drag-source");
      nativeImage?.remove();
      nativeImage = null;
      source = null;
    };

    const start = (event: globalThis.DragEvent) => {
      const dragTarget =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>("[draggable='true']")
          : null;
      if (!dragTarget || !event.dataTransfer) return;

      clear();
      window.dispatchEvent(new CustomEvent(DRAG_START_EVENT));
      source =
        dragTarget.closest<HTMLElement>("[data-drag-highlight]") ?? dragTarget;
      source.dataset.liveDragSource = "true";

      nativeImage = makeTransparentDragImage();
      event.dataTransfer.setDragImage(nativeImage, 0, 0);
    };

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !source) return;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(DRAG_CANCEL_EVENT));
      clear();
    };

    const end = () => {
      window.dispatchEvent(new CustomEvent(DRAG_END_EVENT));
      clear();
    };

    document.addEventListener("dragstart", start, true);
    document.addEventListener("drop", clear, true);
    document.addEventListener("dragend", end, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      document.removeEventListener("dragstart", start, true);
      document.removeEventListener("drop", clear, true);
      document.removeEventListener("dragend", end, true);
      window.removeEventListener("keydown", cancel, true);
      clear();
    };
  }, []);

  return null;
}
