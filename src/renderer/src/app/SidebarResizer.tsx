import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@renderer/shared/classNames";

interface SidebarResizerProps {
  "aria-label": string;
  edge?: "left" | "right";
  width: number;
  maxWidth: number;
  minWidth?: number;
  onWidthChange: (width: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (width: number) => void;
  onReset?: () => void;
}

const KEYBOARD_RESIZE_STEP = 10;

export const SidebarResizer = ({
  "aria-label": ariaLabel,
  edge = "right",
  width,
  minWidth = 0,
  maxWidth,
  onWidthChange,
  onResizeStart,
  onResizeEnd,
  onReset,
}: SidebarResizerProps) => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const clampWidth = useCallback(
    (nextWidth: number) => Math.min(maxWidth, Math.max(minWidth, nextWidth)),
    [maxWidth, minWidth],
  );

  const cleanup = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      cleanup();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = width;
      let currentWidth = width;
      let finished = false;

      const onResize = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const delta = moveEvent.clientX - startX;
        currentWidth = clampWidth(startWidth + (edge === "right" ? delta : -delta));
        onWidthChange(currentWidth);
      };

      const removeListeners = () => {
        window.removeEventListener("pointermove", onResize);
        window.removeEventListener("pointerup", stopPointerResize);
        window.removeEventListener("pointercancel", stopPointerResize);
        window.removeEventListener("blur", finishResize);
        document.body.classList.remove("pane-resizing");
      };

      const finishResize = () => {
        if (finished) return;
        finished = true;
        removeListeners();
        cleanupRef.current = null;
        onResizeEnd?.(currentWidth);
      };

      const stopPointerResize = (endEvent: PointerEvent) => {
        if (endEvent.pointerId === pointerId) finishResize();
      };

      cleanupRef.current = removeListeners;
      window.addEventListener("pointermove", onResize);
      window.addEventListener("pointerup", stopPointerResize);
      window.addEventListener("pointercancel", stopPointerResize);
      window.addEventListener("blur", finishResize);
      document.body.classList.add("pane-resizing");
      onResizeStart?.();

      event.currentTarget.focus();
      event.preventDefault();
      event.stopPropagation();
    },
    [clampWidth, cleanup, edge, onResizeEnd, onResizeStart, onWidthChange, width],
  );

  const resizeWithKeyboard = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      let nextWidth: number | undefined;
      const direction = edge === "right" ? 1 : -1;

      if (event.key === "ArrowLeft") nextWidth = width - KEYBOARD_RESIZE_STEP * direction;
      if (event.key === "ArrowRight") nextWidth = width + KEYBOARD_RESIZE_STEP * direction;
      if (event.key === "Home") nextWidth = minWidth;
      if (event.key === "End") nextWidth = maxWidth;
      if (nextWidth === undefined) return;

      event.preventDefault();
      const clampedWidth = clampWidth(nextWidth);
      onWidthChange(clampedWidth);
      onResizeEnd?.(clampedWidth);
    },
    [clampWidth, edge, maxWidth, minWidth, onResizeEnd, onWidthChange, width],
  );

  return (
    <div
      className={cn("pane-resize-divider sidebar-resize-divider", edge === "left" && "sidebar-resize-divider-left")}
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={startResize}
      onDoubleClick={onReset}
      title="Drag to resize. Double-click to reset."
    >
      <div className="pane-resize-handle sidebar-resize-handle" />
    </div>
  );
};
