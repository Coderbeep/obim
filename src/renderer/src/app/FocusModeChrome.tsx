import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";
import { activePaneIdAtom } from "@renderer/store/editorPaneStore";
import { focusPaneContent } from "./useFocusMode";

import { focusModePaneIdAtom, focusModeRevealedEdgeAtom, type FocusModeEdge } from "@renderer/store/focusModeStore";

const EDGE_SIZE = 48;
const BAR_PROXIMITY = 24;
const HIDE_DELAY = 180;
const surfaceSelector = (edge: FocusModeEdge) =>
  edge === "bottom"
    ? ".app-status-bar"
    : `.sidebar-shell[data-side="${edge}"], .right-sidebar-shell[data-side="${edge}"]`;

/** Observe pointer position without putting mouse-catching hit areas over content. */
export const FocusModeChrome = () => {
  const focused = Boolean(useAtomValue(focusModePaneIdAtom));
  const reveal = useSetAtom(focusModeRevealedEdgeAtom);
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    const shell = ref.current?.closest<HTMLElement>(".app-shell");
    if (!shell) return;
    let hideTimer: number | undefined;
    let pointerTarget: EventTarget | null = null;
    let pointerEdge: FocusModeEdge | null = null;
    let pointerPosition: { x: number; y: number } | null = null;
    const cancelHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    };
    const isInSurface = (node: EventTarget | null, edge: FocusModeEdge) =>
      node instanceof Node &&
      (shell.querySelector(surfaceSelector(edge))?.contains(node) ||
        ref.current?.querySelector(`[data-edge="${edge}"]`) === node);
    const isNearSurface = (edge: FocusModeEdge) => {
      const bounds = shell.querySelector(surfaceSelector(edge))?.getBoundingClientRect();
      return Boolean(
        pointerPosition &&
        bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        pointerPosition.x >= bounds.left - BAR_PROXIMITY &&
        pointerPosition.x <= bounds.right + BAR_PROXIMITY &&
        pointerPosition.y >= bounds.top - BAR_PROXIMITY &&
        pointerPosition.y <= bounds.bottom + BAR_PROXIMITY,
      );
    };
    const keepOpen = (edge: FocusModeEdge) =>
      pointerEdge === edge ||
      isInSurface(pointerTarget, edge) ||
      isNearSurface(edge) ||
      isInSurface(document.activeElement, edge) ||
      document.body.classList.contains("pane-resizing") ||
      Boolean(
        document.querySelector(
          '[role="menu"], [role="dialog"], [role="alertdialog"], .menu-surface[data-state="open"]',
        ),
      );
    const scheduleHide = () => {
      if (hideTimer !== undefined) return;
      hideTimer = window.setTimeout(() => {
        hideTimer = undefined;
        const edge = store.get(focusModeRevealedEdgeAtom);
        if (edge && !keepOpen(edge)) reveal(null);
      }, HIDE_DELAY);
    };
    const pointerMove = (event: PointerEvent) => {
      // Selecting text or dragging content to an edge must not open chrome.
      if (event.buttons || document.body.classList.contains("pane-resizing")) return;
      const bounds = shell.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      pointerTarget = event.target;
      pointerPosition = inside ? { x: event.clientX, y: event.clientY } : null;
      const current = store.get(focusModeRevealedEdgeAtom);
      // Keep an open bar's controls usable even where its edge meets another bar.
      if (inside && current && (isInSurface(event.target, current) || isNearSurface(current))) {
        pointerEdge = null;
        cancelHide();
        return;
      }
      const edge: FocusModeEdge | null = !inside
        ? null
        : event.clientY >= bounds.bottom - EDGE_SIZE
          ? "bottom"
          : event.clientX <= bounds.left + EDGE_SIZE
            ? "left"
            : event.clientX >= bounds.right - EDGE_SIZE
              ? "right"
              : null;
      pointerEdge = edge;
      if (edge) {
        cancelHide();
        reveal(edge);
        return;
      }
      if (current && (isInSurface(event.target, current) || keepOpen(current))) cancelHide();
      else scheduleHide();
    };
    const focusChanged = () => {
      cancelHide();
      scheduleHide();
    };
    const leave = () => {
      pointerTarget = null;
      pointerEdge = null;
      pointerPosition = null;
      scheduleHide();
    };
    const blur = () => {
      cancelHide();
      pointerTarget = null;
      pointerEdge = null;
      pointerPosition = null;
      reveal(null);
    };
    window.addEventListener("pointermove", pointerMove, true);
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("focusout", focusChanged);
    shell.addEventListener("pointerleave", leave);
    window.addEventListener("blur", blur);
    return () => {
      cancelHide();
      window.removeEventListener("pointermove", pointerMove, true);
      document.removeEventListener("focusin", focusChanged);
      document.removeEventListener("focusout", focusChanged);
      shell.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", blur);
    };
  }, [focused, reveal, store]);

  const activate = (edge: FocusModeEdge) => {
    reveal(edge);
    // Enter/Space on an edge control also gives keyboard users a way into its bar.
    window.setTimeout(() => {
      if (!store.get(focusModePaneIdAtom) || store.get(focusModeRevealedEdgeAtom) !== edge) return;
      const surface = ref.current?.closest(".app-shell")?.querySelector(surfaceSelector(edge));
      surface
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        )
        ?.focus({ preventScroll: true });
    }, 0);
  };

  if (!focused) return null;
  return (
    <div ref={ref} className="focus-mode-edge-controls">
      {(["left", "right", "bottom"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          className="focus-mode-edge-control"
          data-edge={edge}
          onFocus={() => reveal(edge)}
          onClick={() => activate(edge)}
        >
          {edge === "bottom" ? "Show status bar" : `Show ${edge} sidebar`}
        </button>
      ))}
    </div>
  );
};

export const useFocusModeBar = (edge: FocusModeEdge) => {
  const focused = Boolean(useAtomValue(focusModePaneIdAtom));
  const revealedEdge = useAtomValue(focusModeRevealedEdgeAtom);
  const reveal = useSetAtom(focusModeRevealedEdgeAtom);
  const paneId = useAtomValue(activePaneIdAtom);
  return {
    focused,
    revealed: focused && revealedEdge === edge,
    close: () => {
      reveal(null);
      focusPaneContent(paneId);
    },
  };
};
