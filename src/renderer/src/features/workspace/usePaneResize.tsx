import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

import type { WorkspacePaneState } from "@renderer/store/editorPaneStore";

import { normalizePaneSize } from "./paneLayout";

const PANE_GAP_PX = 10;
const MIN_PANE_WIDTH_PX = 260;

type PendingResize = {
  leftPaneId: string;
  rightPaneId: string;
  leftSize: number;
  rightSize: number;
};

export const usePaneResize = (
  panes: WorkspacePaneState[],
  paneGridRef: RefObject<HTMLDivElement | null>,
  resizePanePair: (leftPaneId: string, rightPaneId: string, leftSize: number, rightSize: number) => void,
) => {
  const cleanupRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingResize | null>(null);

  const flush = () => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    resizePanePair(pending.leftPaneId, pending.rightPaneId, pending.leftSize, pending.rightSize);
  };

  const clear = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    flush();
    document.body.classList.remove("pane-resizing");
  };

  useEffect(() => clear, []);

  return (event: ReactMouseEvent<HTMLDivElement>, leftPaneId: string, rightPaneId: string) => {
    const grid = paneGridRef.current;
    const leftPane = panes.find((pane) => pane.id === leftPaneId);
    const rightPane = panes.find((pane) => pane.id === rightPaneId);
    if (!grid || !leftPane || !rightPane) return;

    event.preventDefault();
    event.stopPropagation();
    clear();

    const totalSize = panes.reduce((sum, pane) => sum + normalizePaneSize(pane.size), 0);
    const availableWidth = Math.max(1, grid.clientWidth - Math.max(0, panes.length - 1) * PANE_GAP_PX);
    const pairSize = normalizePaneSize(leftPane.size) + normalizePaneSize(rightPane.size);
    const startLeftSize = normalizePaneSize(leftPane.size);
    const startX = event.clientX;
    const minSize = Math.min((MIN_PANE_WIDTH_PX / availableWidth) * totalSize, pairSize / 2) || 0.01;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaSize = ((moveEvent.clientX - startX) / availableWidth) * totalSize;
      const leftSize = Math.min(pairSize - minSize, Math.max(minSize, startLeftSize + deltaSize));
      pendingRef.current = { leftPaneId, rightPaneId, leftSize, rightSize: pairSize - leftSize };
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        flush();
      });
    };
    const finish = () => clear();

    document.body.classList.add("pane-resizing");
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    cleanupRef.current = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
    };
  };
};
