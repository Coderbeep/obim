import { atom } from "jotai";
import { DEFAULT_FOCUS_MODE_LAYOUT, type FocusModeLayout } from "@shared/config";

import { shortcutHelpOpenAtom } from "./appSessionStore";
import { activePaneIdAtom, workspacePanesAtom } from "./editorPaneStore";
import { workspaceTabsByIdAtom } from "./editorTabStore";

const focusModeLayoutPreferenceAtom = atom<FocusModeLayout>(DEFAULT_FOCUS_MODE_LAYOUT);

/** App preference; the renderer coordinator initializes it from saved config. */
export const focusModeLayoutAtom = atom<FocusModeLayout, [FocusModeLayout], void>(
  (get) => get(focusModeLayoutPreferenceAtom),
  (get, set, layout: FocusModeLayout) => {
    if (layout === get(focusModeLayoutPreferenceAtom)) return;
    const focused = Boolean(get(focusModePaneIdAtom));
    set(focusModeLayoutPreferenceAtom, layout);
    if (focused) set(focusModeTargetPaneIdAtom, get(activePaneIdAtom));
  },
);

/** Presentation state only; never included in the saved workspace layout. */
export const focusModeTargetPaneIdAtom = atom<string | null>(null);

export type FocusModeEdge = "left" | "right" | "bottom";
/** Temporary chrome visibility; never changes saved sidebar/layout preferences. */
export const focusModeRevealedEdgeAtom = atom<FocusModeEdge | null>(null);

export const canEnterFocusModeAtom = atom((get) => {
  const pane = get(workspacePanesAtom).find((candidate) => candidate.id === get(activePaneIdAtom));
  return Boolean(pane?.activeTabId && get(workspaceTabsByIdAtom)[pane.activeTabId]);
});

/** All-pane focus follows the active pane; single-pane focus requires its original target. */
export const focusModePaneIdAtom = atom((get) => {
  const target = get(focusModeTargetPaneIdAtom);
  if (!target) return null;
  const activePaneId = get(activePaneIdAtom);
  if (get(focusModeLayoutAtom) === "active-pane")
    return target === activePaneId && get(canEnterFocusModeAtom) ? target : null;
  const panes = get(workspacePanesAtom);
  const tabs = get(workspaceTabsByIdAtom);
  return panes.some((pane) => pane.id === activePaneId) &&
    panes.some((pane) => pane.activeTabId && tabs[pane.activeTabId])
    ? activePaneId
    : null;
});

export const exitFocusModeAtom = atom(null, (_get, set) => {
  set(focusModeRevealedEdgeAtom, null);
  set(focusModeTargetPaneIdAtom, null);
});

export const toggleFocusModeAtom = atom(null, (get, set, paneId?: string) => {
  if (get(focusModePaneIdAtom)) {
    set(exitFocusModeAtom);
    return;
  }
  const target = paneId ?? get(activePaneIdAtom);
  const pane = get(workspacePanesAtom).find((candidate) => candidate.id === target);
  if (!pane?.activeTabId || !get(workspaceTabsByIdAtom)[pane.activeTabId]) return;
  set(activePaneIdAtom, target);
  set(shortcutHelpOpenAtom, false);
  set(focusModeRevealedEdgeAtom, null);
  set(focusModeTargetPaneIdAtom, target);
});
