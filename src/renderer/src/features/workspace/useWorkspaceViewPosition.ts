import { useStore } from "jotai";
import { useCallback, useMemo } from "react";
import { saveWorkspaceViewPositionAtom } from "@renderer/store/editorTabStore";
import { workspaceViewPositionsAtom, type WorkspaceViewPosition } from "@renderer/store/workspaceViewStateStore";

export const useWorkspaceViewPosition = (tabId: string | undefined, resourceKey: string) => {
  const store = useStore();
  // Restoration is a mount-time snapshot; saving must not make a mounted viewer jump.
  const initialPosition = useMemo(
    () => (tabId ? store.get(workspaceViewPositionsAtom)[tabId]?.[resourceKey] : undefined),
    [store, tabId, resourceKey],
  );
  const savePosition = useCallback(
    (position: WorkspaceViewPosition) => {
      if (tabId) store.set(saveWorkspaceViewPositionAtom, { tabId, resourceKey, position });
    },
    [store, tabId, resourceKey],
  );
  return { initialPosition, savePosition };
};
