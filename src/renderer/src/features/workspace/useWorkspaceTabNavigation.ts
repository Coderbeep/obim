import { useStore } from "jotai";
import { useCallback } from "react";

import { workspacePanesAtom } from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "@renderer/store/editorTabStore";
import { openWorkspaceItemsByKeyAtom } from "@renderer/store/workspaceResourceStore";
import { getWorkspaceHistoryTarget } from "@renderer/store/workspaceTransitions";

import type { OpenWorkspaceItem, WorkspaceItemResolver } from "./workspaceItemOperations";

/**
 * Provides backward and forward navigation for the active tab in a pane.
 *
 * A history change is committed only after the target item opens successfully,
 * preventing failed or stale asynchronous opens from advancing tab history.
 */
export const useWorkspaceTabNavigation = ({
  openWorkspaceItem,
  resolveWorkspaceItem,
}: {
  openWorkspaceItem: OpenWorkspaceItem;
  resolveWorkspaceItem: WorkspaceItemResolver;
}) => {
  const store = useStore();

  const navigate = useCallback(
    (direction: "back" | "forward", paneId: string) => {
      const pane = store.get(workspacePanesAtom).find((candidate) => candidate.id === paneId);
      const tabId = pane?.activeTabId;
      if (!tabId) return;

      const tab = store.get(workspaceTabsByIdAtom)[tabId];
      if (!tab) return;
      const targetResourceKey = getWorkspaceHistoryTarget(tab, direction);
      if (!targetResourceKey) return;

      const target = resolveWorkspaceItem(targetResourceKey, store.get(openWorkspaceItemsByKeyAtom));
      if (!target) return;
      return openWorkspaceItem(target, {
        paneId: paneId,
        targetTabId: tabId,
        historyDirection: direction,
      });
    },
    [openWorkspaceItem, resolveWorkspaceItem, store],
  );

  return {
    goBackward: (paneId: string) => navigate("back", paneId),
    goForward: (paneId: string) => navigate("forward", paneId),
  };
};
