import { waitForWorkspaceActivity } from "@renderer/store/workspaceTransitionStore";
import { getWorkspaceTabBufferPaths } from "@renderer/store/workspaceBufferOwnership";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import {
  hasPendingFileSaves,
  saveDirtyFileBuffers,
  waitForPendingFileSaves,
} from "@renderer/features/files/dirtyFileBuffers";
import { parseJsonData } from "@renderer/shared/parseJsonData";
import { useAppDndActions } from "@renderer/shared/dnd/AppDndProvider";
import { activePaneIdAtom, workspacePanesAtom } from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "@renderer/store/editorTabStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import {
  activateWorkspaceResourceAtom,
  activateWorkspaceTabAtom,
  closeWorkspaceTabAtom,
  insertWorkspacePaneAtom,
  moveWorkspaceTabAtom,
  moveWorkspacePaneAtom,
  removeEmptyWorkspacePaneAtom,
  resizeWorkspacePanePairAtom,
  splitWorkspaceTabAtom,
} from "@renderer/store/workspaceActionStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { openWorkspaceItemsByKeyAtom } from "@renderer/store/workspaceResourceStore";
import { isFileWorkspaceItem, type WorkspaceItem } from "@shared/workspace";
import type { PaneSplitSide } from "@renderer/store/workspaceTransitions";
import { FILE_DRAG_DATA_MIME, TAB_DRAG_DATA_MIME, type FileDragData, type TabDragData } from "@shared/drag-data";
import type { FileItem } from "@shared/file-item";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import { findItemNode } from "@renderer/features/files/fileTreeUtils";

import type { WorkspaceItemResolver } from "./workspaceItemOperations";
import type { WorkspaceItemViewMap } from "./workspaceItemView";

export const createNewPaneId = () => `pane-${crypto.randomUUID()}`;

export const usePaneTabActivation = () => {
  const activate = useSetAtom(activateWorkspaceResourceAtom);
  const activateResource = useCallback(
    (resourceKey: string, options?: { item?: WorkspaceItem; paneId?: string }) => activate({ resourceKey, ...options }),
    [activate],
  );
  return { activateResource };
};

export const useCloseTabAction = ({
  onClosed,
  resolveWorkspaceItem,
}: {
  onClosed?: (closed: { item: WorkspaceItem; paneId: string; tabId: string }) => void;
  resolveWorkspaceItem: WorkspaceItemResolver;
  views: WorkspaceItemViewMap;
}) => {
  const store = useStore();
  const closeWorkspaceTab = useSetAtom(closeWorkspaceTabAtom);

  const closeTab = useCallback(
    async (paneId: string, tabId: string) => {
      const resourceKey = store.get(workspaceTabsByIdAtom)[tabId]?.currentResourceKey;
      if (!resourceKey) return false;

      const item = resolveWorkspaceItem(resourceKey, store.get(openWorkspaceItemsByKeyAtom));
      const saved = await saveDirtyFileBuffers(store, (path) =>
        getWorkspaceTabBufferPaths(store.get, tabId).includes(path),
      );
      if (!saved.success) return false;
      if (store.get(workspaceTabsByIdAtom)[tabId]?.currentResourceKey !== resourceKey) return false;

      if (!closeWorkspaceTab({ paneId, tabId })) return false;
      if (item) onClosed?.({ item, paneId, tabId });
      return true;
    },
    [closeWorkspaceTab, onClosed, resolveWorkspaceItem, store],
  );

  const closeActiveTab = useCallback(() => {
    const panes = store.get(workspacePanesAtom);
    const activePane = panes.find((pane) => pane.id === store.get(activePaneIdAtom)) ?? panes[0];
    return activePane?.activeTabId ? closeTab(activePane.id, activePane.activeTabId) : Promise.resolve(false);
  }, [closeTab, store]);

  return { closeActiveTab, closeTab };
};

export const useAppCloseGuard = () => {
  const store = useStore();

  useEffect(() => {
    const removeRequestListener = window.api.onAppCloseRequested?.(async (requestId) => {
      let allow = false;
      try {
        await window.api.cancelGitSync?.();
        await waitForWorkspaceActivity();
        await waitForPendingFileSaves();
        const saved = await saveDirtyFileBuffers(store);
        await waitForPendingFileSaves();
        allow =
          saved.success &&
          !hasPendingFileSaves() &&
          Object.values(store.get(fileBuffersByPathAtom)).every((buffer) => buffer.savedText === buffer.editorText);
      } catch (error) {
        console.error("Could not prepare the workspace for app close:", error);
      }
      window.api.respondToAppClose?.(requestId, allow);
    });
    const removeTimeoutListener = window.api.onAppCloseTimeout?.(() => {
      store.set(addNotificationAtom, {
        id: crypto.randomUUID(),
        level: NotificationLevel.ERROR,
        title: "Could not close app",
        message: "Saving did not finish in time. The window stayed open so your changes are not lost.",
        timestamp: Date.now(),
      });
    });

    return () => {
      removeRequestListener?.();
      removeTimeoutListener?.();
    };
  }, [store]);
};

/**
 * Applies workspace tab, pane, and split semantics to native drag events.
 *
 * The hook mutates workspace session state. Explorer files dropped here are
 * opened in a pane; they are not moved on disk.
 *
 * @param options File-opening service and workspace item resolvers.
 * @returns Workspace state and handlers consumed by the pane grid.
 */
export const usePaneWorkspace = ({
  openDroppedFile,
  resolveWorkspaceItem,
  views,
}: {
  openDroppedFile: (file: FileItem, options: { openInNewTab: true; paneId: string }) => Promise<boolean>;
  resolveWorkspaceItem: WorkspaceItemResolver;
  views: WorkspaceItemViewMap;
}) => {
  const appDnd = useAppDndActions();
  const onPaneDragOver = (event: DragEvent<HTMLElement>) => {
    const entity = appDnd.getActiveEntity();
    if (
      entity?.kind !== "workspace-tab" &&
      !(entity?.kind === "explorer-item" && event.dataTransfer.types.includes(FILE_DRAG_DATA_MIME))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = entity.kind === "workspace-tab" ? "move" : "copy";
  };
  const store = useStore();
  const panes = useAtomValue(workspacePanesAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const tabsById = useAtomValue(workspaceTabsByIdAtom);
  const openWorkspaceItemsByKey = useAtomValue(openWorkspaceItemsByKeyAtom);
  const activateTabAction = useSetAtom(activateWorkspaceTabAtom);
  const moveTabAction = useSetAtom(moveWorkspaceTabAtom);
  const splitTab = useSetAtom(splitWorkspaceTabAtom);
  const insertPane = useSetAtom(insertWorkspacePaneAtom);
  const removeEmptyPane = useSetAtom(removeEmptyWorkspacePaneAtom);
  const resizePanePairAction = useSetAtom(resizeWorkspacePanePairAtom);
  const movePaneAction = useSetAtom(moveWorkspacePaneAtom);
  const [closedTabs, setClosedTabs] = useState<Array<{ item: WorkspaceItem; paneId: string }>>([]);
  const rememberClosedTab = useCallback(({ item, paneId }: { item: WorkspaceItem; paneId: string }) => {
    setClosedTabs((current) => [{ item, paneId }, ...current].slice(0, 20));
  }, []);
  const { closeTab, closeActiveTab } = useCloseTabAction({ onClosed: rememberClosedTab, resolveWorkspaceItem, views });

  const activateTab = (paneId: string, tabId: string) => activateTabAction({ paneId, tabId });

  const onTabDragStart = (event: DragEvent<HTMLElement>, paneId: string, tabId: string) => {
    const payload: TabDragData = { sourcePaneId: paneId, tabId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TAB_DRAG_DATA_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", tabsById[tabId]?.currentResourceKey ?? "");
  };

  const moveTab = (sourcePaneId: string, targetPaneId: string, tabId: string, targetIndex?: number) =>
    moveTabAction({ sourcePaneId, targetPaneId, tabId, targetIndex });

  const movePane = (paneId: string, direction: "left" | "right") => {
    const current = store.get(workspacePanesAtom);
    const index = current.findIndex((pane) => pane.id === paneId);
    if (index < 0 || (direction === "left" ? index === 0 : index === current.length - 1)) return false;
    return movePaneAction({ paneId, boundaryIndex: direction === "left" ? index - 1 : index + 2 });
  };

  const moveTabToNewPane = (sourcePaneId: string, targetPaneId: string, tabId: string, side: PaneSplitSide) =>
    splitTab({ sourcePaneId, targetPaneId, tabId, side, newPaneId: createNewPaneId() });

  const openFileInNewPane = async (file: FileItem, targetPaneId: string, side: PaneSplitSide) => {
    if (file.isDirectory || !store.get(workspacePanesAtom).some((pane) => pane.id === targetPaneId)) return false;
    const paneId = createNewPaneId();
    insertPane({ targetPaneId, side, paneId });
    const opened = await openDroppedFile(file, { paneId, openInNewTab: true });
    if (!opened) removeEmptyPane(paneId);
    return opened;
  };

  const onPaneDrop = (event: DragEvent<HTMLElement>, paneId: string, targetIndex?: number) => {
    const entity = appDnd.getActiveEntity();
    if (!entity || !appDnd.canCommit(entity.kind)) return;
    event.preventDefault();
    event.stopPropagation();

    if (entity.kind === "workspace-tab") {
      moveTab(entity.sourcePaneId, paneId, entity.id, targetIndex);
      appDnd.complete();
      return;
    }

    if (entity.kind !== "explorer-item") return;
    const fileData = parseJsonData<FileDragData>(event.dataTransfer.getData(FILE_DRAG_DATA_MIME));
    const file = fileData ? findItemNode(store.get(fileTreeAtom), fileData.path) : null;
    if (file) {
      void openDroppedFile(file, { paneId, openInNewTab: true });
      appDnd.complete();
    }
  };

  const onPaneSplitDrop = async (event: DragEvent<HTMLElement>, paneId: string, side: PaneSplitSide) => {
    const entity = appDnd.getActiveEntity();
    if (!entity || !appDnd.canCommit(entity.kind)) return false;
    event.preventDefault();
    event.stopPropagation();

    if (entity.kind === "workspace-tab") {
      if (!moveTabToNewPane(entity.sourcePaneId, paneId, entity.id, side)) return false;
      appDnd.complete();
      return true;
    }

    if (entity.kind !== "explorer-item") return false;
    const fileData = parseJsonData<FileDragData>(event.dataTransfer.getData(FILE_DRAG_DATA_MIME));
    const file = fileData ? findItemNode(store.get(fileTreeAtom), fileData.path) : null;
    const opened = file ? await openFileInNewPane(file, paneId, side) : false;
    if (opened) appDnd.complete();
    return opened;
  };

  const resizePanePair = (leftPaneId: string, rightPaneId: string, leftSize: number, rightSize: number) =>
    resizePanePairAction({ leftPaneId, rightPaneId, leftSize, rightSize });

  const closeOtherTabs = async (paneId: string, keepTabId: string) => {
    const pane = store.get(workspacePanesAtom).find((candidate) => candidate.id === paneId);
    if (!pane) return false;
    const tabIds = pane.tabs.filter((candidate) => candidate !== keepTabId);
    const matches = (path: string) =>
      tabIds.some((tabId) => getWorkspaceTabBufferPaths(store.get, tabId).includes(path));
    if (!(await saveDirtyFileBuffers(store, matches)).success) return false;
    for (const tabId of tabIds) {
      if (!(await closeTab(paneId, tabId))) return false;
    }
    return true;
  };

  const reopenLastClosedTab = useCallback(async () => {
    const closed = closedTabs[0];
    if (!closed) return false;
    const targetPaneId = store.get(workspacePanesAtom).some((pane) => pane.id === closed.paneId)
      ? closed.paneId
      : store.get(activePaneIdAtom);
    const opened = isFileWorkspaceItem(closed.item)
      ? await openDroppedFile(closed.item.file, { paneId: targetPaneId, openInNewTab: true })
      : Boolean(
          store.set(activateWorkspaceResourceAtom, {
            item: closed.item,
            paneId: targetPaneId,
            resourceKey: closed.item.key,
          }),
        );
    if (opened) setClosedTabs((current) => current.slice(1));
    return opened;
  }, [closedTabs, openDroppedFile, store]);
  const reopenLastClosedTabRef = useRef(reopenLastClosedTab);
  const closeActiveTabRef = useRef(closeActiveTab);

  useEffect(() => {
    reopenLastClosedTabRef.current = reopenLastClosedTab;
  }, [reopenLastClosedTab]);

  useEffect(() => {
    closeActiveTabRef.current = closeActiveTab;
  }, [closeActiveTab]);

  useEffect(() => window.api?.onCloseCurrentTabShortcut?.(() => void closeActiveTabRef.current()), []);
  useEffect(() => window.api?.onReopenLastClosedTabShortcut?.(() => void reopenLastClosedTabRef.current()), []);

  return {
    panes,
    activePaneId,
    tabsById,
    openWorkspaceItemsByKey,
    activateTab,
    closeTab,
    closeActiveTab,
    closeOtherTabs,
    canReopenClosedTab: closedTabs.length > 0,
    reopenLastClosedTab,
    movePane,
    moveTab,
    moveTabToNewPane,
    onTabDragStart,
    onPaneDragOver,
    onPaneDrop,
    onPaneSplitDrop,
    resizePanePair,
  };
};

export type { PaneSplitSide } from "@renderer/store/workspaceTransitions";
