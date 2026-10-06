import type { FileTree as FileTreeModel } from "@pierre/trees";
import { useCallback, useEffect, useRef } from "react";

import { getTransparentDragImage } from "@renderer/shared/dnd/getTransparentDragImage";
import { useAppDndActions, type AppDragPreview } from "@renderer/shared/dnd/AppDndProvider";
import type { AppDragEntity } from "@shared/drag-data";

import { getExplorerTreeEventTarget, type ExplorerTreeEventTarget } from "./explorerTreeDom";

interface UseExplorerTreeDndOptions<TPreview extends object> {
  enabled: boolean;
  model: FileTreeModel;
  getDraggedItemPreviewData: (event: DragEvent, target: ExplorerTreeEventTarget) => TPreview | null;
  getAppDragEntity: (data: TPreview, target: ExplorerTreeEventTarget) => AppDragEntity;
  getAppDragPreview: (data: TPreview) => AppDragPreview;
  onTreeDragOver?: (event: DragEvent, target: ExplorerTreeEventTarget | null) => void;
}

/** Bridges Pierre's native tree session into the shared drag lifecycle. */
export const useExplorerTreeDnd = <TPreview extends object>({
  enabled,
  model,
  getDraggedItemPreviewData,
  getAppDragEntity,
  getAppDragPreview,
  onTreeDragOver,
}: UseExplorerTreeDndOptions<TPreview>) => {
  const appDnd = useAppDndActions();
  const dragSourceTreePathRef = useRef<string | null>(null);

  const startTreeDragPreview = useCallback(
    (event: DragEvent) => {
      if (!enabled) return;
      const target = getExplorerTreeEventTarget(event);
      if (!target || !event.dataTransfer) return;
      const data = getDraggedItemPreviewData(event, target);
      if (!data) return;
      event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
      dragSourceTreePathRef.current = target.rowPath;
      appDnd.startDrag({ entity: getAppDragEntity(data, target), event, preview: getAppDragPreview(data) });
    },
    [appDnd, enabled, getAppDragEntity, getAppDragPreview, getDraggedItemPreviewData],
  );

  const clearDragPreview = useCallback(() => {
    dragSourceTreePathRef.current = null;
    appDnd.updateTarget(null);
  }, [appDnd]);

  useEffect(() => {
    if (!enabled) return undefined;
    let frameId: number | null = null;
    let cleanup: (() => void) | null = null;
    const attach = () => {
      const host = model.getFileTreeContainer();
      const eventTarget = host?.shadowRoot ?? host;
      if (!host || !eventTarget) {
        frameId = window.requestAnimationFrame(attach);
        return;
      }
      const handleNativeDragStart = (event: Event) => {
        if (event instanceof DragEvent) startTreeDragPreview(event);
      };
      const handleNativeDragOver = (event: Event) => {
        if (event instanceof DragEvent && event.clientX !== 0 && event.clientY !== 0)
          onTreeDragOver?.(event, getExplorerTreeEventTarget(event));
      };
      const handleNativeDragEnd = () => clearDragPreview();
      eventTarget.addEventListener("dragstart", handleNativeDragStart);
      eventTarget.addEventListener("dragover", handleNativeDragOver);
      eventTarget.addEventListener("dragend", handleNativeDragEnd);
      eventTarget.addEventListener("drop", handleNativeDragEnd);
      document.addEventListener("drop", handleNativeDragEnd);
      document.addEventListener("dragend", handleNativeDragEnd, true);
      window.addEventListener("blur", handleNativeDragEnd);
      cleanup = () => {
        eventTarget.removeEventListener("dragstart", handleNativeDragStart);
        eventTarget.removeEventListener("dragover", handleNativeDragOver);
        eventTarget.removeEventListener("dragend", handleNativeDragEnd);
        eventTarget.removeEventListener("drop", handleNativeDragEnd);
        document.removeEventListener("drop", handleNativeDragEnd);
        document.removeEventListener("dragend", handleNativeDragEnd, true);
        window.removeEventListener("blur", handleNativeDragEnd);
      };
    };
    attach();
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      cleanup?.();
    };
  }, [clearDragPreview, enabled, model, onTreeDragOver, startTreeDragPreview]);

  return { clearDragPreview, dragSourceTreePathRef };
};
