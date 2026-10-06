import { useRef, type DragEvent, type PointerEvent } from "react";

import type { AppDragEntity } from "@shared/drag-data";

import { APP_DND_INTERACTIVE_SELECTOR } from "./config";
import { getTransparentDragImage } from "./getTransparentDragImage";
import { useAppDndActions, type AppDragPreview } from "./AppDndProvider";

interface UseAppDraggableOptions<T extends HTMLElement> {
  enabled?: boolean;
  entity: AppDragEntity;
  onCancel?: () => void;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent<T>) => void;
  preview: AppDragPreview;
}

/**
 * Adds canonical native-drag behavior to an internal draggable element.
 *
 * The hook blocks interactive descendants, registers the shared overlay, and
 * clears source state when the native drag ends.
 *
 * @param options Semantic entity, preview content, and feature lifecycle hooks.
 * @returns Props to spread onto the element that starts the native drag.
 */
export const useAppDraggable = <T extends HTMLElement>({
  enabled = true,
  entity,
  onCancel,
  onDragEnd,
  onDragStart,
  preview,
}: UseAppDraggableOptions<T>) => {
  const dnd = useAppDndActions();
  const pressBlocked = useRef(false);
  const sourceRef = useRef<T | null>(null);
  const clearDragging = () => {
    if (sourceRef.current) delete sourceRef.current.dataset.dragging;
    sourceRef.current = null;
  };

  return {
    "data-app-draggable": enabled ? "true" : undefined,
    draggable: enabled || undefined,
    onPointerDownCapture: (event: PointerEvent<T>) => {
      const target = event.target instanceof Element ? event.target : null;
      const explicitHandle = target?.closest("[data-app-drag-handle]");
      const interactive = target?.closest(APP_DND_INTERACTIVE_SELECTOR);
      pressBlocked.current = Boolean(!explicitHandle && interactive && interactive !== event.currentTarget);
    },
    onDragStart: (event: DragEvent<T>) => {
      if (!enabled || pressBlocked.current) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      sourceRef.current = event.currentTarget;
      event.currentTarget.dataset.dragging = "true";
      event.dataTransfer?.setDragImage?.(getTransparentDragImage(), 0, 0);
      onDragStart?.(event);
      dnd.startDrag({ entity, event, onCancel, onFinish: clearDragging, preview });
    },
    onDragEnd: () => {
      pressBlocked.current = false;
      clearDragging();
      onDragEnd?.();
      dnd.endDrag();
    },
  } as const;
};
