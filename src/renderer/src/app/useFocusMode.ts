import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useLayoutEffect, useRef } from "react";

import { getWorkspacePath } from "@renderer/config";
import { versionHistoryOpenRequestAtom } from "@renderer/store/appSessionStore";
import { activePaneIdAtom } from "@renderer/store/editorPaneStore";
import { exitFocusModeAtom, focusModePaneIdAtom, focusModeTargetPaneIdAtom } from "@renderer/store/focusModeStore";

/** Focus existing content without replacing the editor selection or scrolling it. */
export const focusPaneContent = (paneId: string) => {
  const pane = Array.from(document.querySelectorAll<HTMLElement>("[data-workspace-pane-id]")).find(
    (element) => element.dataset.workspacePaneId === paneId,
  );
  const content = pane?.querySelector<HTMLElement>(".pane-card-content");
  if (!content || content.contains(document.activeElement)) return;
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
  const target = content.querySelector<HTMLElement>('.cm-content, textarea, [contenteditable="true"]');
  (target ?? content).focus({ preventScroll: true });
};

export const useFocusMode = ({ enabled }: { enabled: boolean }) => {
  const store = useStore();
  const target = useAtomValue(focusModeTargetPaneIdAtom);
  const paneId = useAtomValue(focusModePaneIdAtom);
  const exit = useSetAtom(exitFocusModeAtom);
  const versionHistoryRequest = useAtomValue(versionHistoryOpenRequestAtom);
  const workspacePath = enabled ? getWorkspacePath() : null;
  const previousPaneId = useRef<string | null>(null);

  useLayoutEffect(() => {
    exit();
  }, [enabled, exit, versionHistoryRequest, workspacePath]);

  useLayoutEffect(() => {
    if (target && !paneId) exit();
  }, [exit, paneId, target]);

  useEffect(() => {
    const changed = previousPaneId.current !== paneId;
    const wasFocused = previousPaneId.current !== null;
    previousPaneId.current = paneId;
    if (!changed || (!paneId && !wasFocused) || !enabled) return;
    // Wait for menu/dialog focus restoration before reclaiming the writing area.
    const timer = window.setTimeout(() => focusPaneContent(paneId ?? store.get(activePaneIdAtom)), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, paneId, store]);

  return enabled ? paneId : null;
};
