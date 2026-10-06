import type { FileTreeDropResult, FileTree as FileTreeModel } from "@pierre/trees";
import { useStore } from "jotai";
import { useCallback } from "react";

import { useFileMove } from "../fileActions";
import { Notifications } from "@renderer/features/notifications/notifications";
import { addNotificationAtom } from "@renderer/store/NotificationsStore";
import { explorerSelectionPathsAtom } from "@renderer/store/fileExplorerStore";
import { getWorkspacePath } from "@renderer/config";
import { FILE_DRAG_DATA_MIME, type FileDragData } from "@shared/drag-data";
import { useAppDndActions } from "@renderer/shared/dnd/AppDndProvider";

import {
  getFileTreeMoveIntent,
  getTreeDropTargetFromHoveredPath,
  getTreePathName,
  type TreeLookup,
} from "./fileExplorerTreeUtils";
import type { ExplorerTreeEventTarget } from "./tree/explorerTreeDom";
import { useExplorerTreeDnd } from "./tree/useExplorerTreeDnd";

interface UseFileExplorerDndOptions {
  enabled: boolean;
  expandedTreePaths: string[];
  lookupRef: React.MutableRefObject<TreeLookup>;
  model: FileTreeModel;
  onDropCompleteRef: React.MutableRefObject<(event: FileTreeDropResult) => void>;
}

type FileExplorerDragPreviewData = {
  fileName: string;
  isDirectory: boolean;
  subtext?: string;
};

/**
 * Applies filesystem move semantics to Pierre Explorer drags.
 *
 * The adapter writes stable native file payloads, validates folder and root
 * targets, performs filesystem moves, and restores tree state after invalid or
 * failed operations.
 *
 * @param options Explorer model, lookup state, and Pierre drop callback.
 * @returns Pierre drag state connected to the application provider.
 */
export const useFileExplorerDnd = ({
  enabled,
  expandedTreePaths,
  lookupRef,
  model,
  onDropCompleteRef,
}: UseFileExplorerDndOptions) => {
  const appDnd = useAppDndActions();
  const store = useStore();
  const { moveManyToDirectory } = useFileMove();
  const rootDirectoryPath = getWorkspacePath();

  const handleDropComplete = useCallback(
    async (event: FileTreeDropResult) => {
      if (!enabled) return;

      const currentLookup = lookupRef.current;
      if (!appDnd.canCommit("explorer-item")) {
        model.resetPaths(currentLookup.paths, { initialExpandedPaths: expandedTreePaths });
        return;
      }
      const intent = getFileTreeMoveIntent(event.draggedPaths, event.target, currentLookup, rootDirectoryPath);
      const draggedAbsolutePaths = intent?.sourceItems.map((item) => item.path) ?? [];
      if (draggedAbsolutePaths.length) store.set(explorerSelectionPathsAtom, draggedAbsolutePaths);

      if (!intent) {
        model.resetPaths(currentLookup.paths, { initialExpandedPaths: expandedTreePaths });
        return;
      }

      appDnd.complete();

      const result = await moveManyToDirectory(intent.sourceItems, intent.absolutePath);
      const movedPaths = new Map(result.moved.map(({ file, movedPath }) => [file.path, movedPath]));
      store.set(
        explorerSelectionPathsAtom,
        intent.sourceItems.map((item) => movedPaths.get(item.path) ?? item.path),
      );
      if (result.failures.length) {
        model.resetPaths(currentLookup.paths, { initialExpandedPaths: expandedTreePaths });
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          ...Notifications.FILE_MOVE_FAILED(result.moved.length, result.failures.length, result.failures[0].error),
          timestamp: Date.now(),
        });
      }
    },
    [appDnd, enabled, expandedTreePaths, lookupRef, model, moveManyToDirectory, rootDirectoryPath, store],
  );

  onDropCompleteRef.current = handleDropComplete;

  const getDraggedItemPreviewData = useCallback(
    (event: DragEvent, target: ExplorerTreeEventTarget): FileExplorerDragPreviewData | null => {
      const treePath = target.rowPath;
      const file = lookupRef.current.byTreePath.get(treePath);
      if (!file) return null;

      const { dataTransfer } = event;
      if (!dataTransfer) return null;

      dataTransfer.effectAllowed = file.isDirectory ? "move" : "copyMove";
      dataTransfer.setData("text/plain", file.path);
      if (!file.isDirectory) {
        const payload: FileDragData = {
          filename: file.filename,
          mimeType: file.mimeType,
          path: file.path,
          relativePath: file.relativePath,
        };
        dataTransfer.setData(FILE_DRAG_DATA_MIME, JSON.stringify(payload));
      }

      return {
        fileName: file.filename || getTreePathName(treePath),
        isDirectory: file.isDirectory,
      };
    },
    [lookupRef],
  );

  const onTreeDragOver = useCallback(
    (_event: DragEvent, target: ExplorerTreeEventTarget | null) => {
      if (appDnd.getActiveEntity()?.kind !== "explorer-item") return;
      const lookup = lookupRef.current;
      const dropTarget = getTreeDropTargetFromHoveredPath(target?.rowPath ?? null, lookup);
      const intent = getFileTreeMoveIntent(model.getSelectedPaths(), dropTarget, lookup, rootDirectoryPath);
      appDnd.updateTarget({
        valid: Boolean(intent),
        key: `explorer:${intent?.treePath ?? dropTarget.directoryPath ?? "root"}`,
        label: intent ? `Move to ${intent.directory?.filename || "Notes"}` : "this folder",
      });
    },
    [appDnd, lookupRef, model, rootDirectoryPath],
  );

  return useExplorerTreeDnd({
    enabled,
    model,
    getDraggedItemPreviewData,
    onTreeDragOver,
    getAppDragEntity: (_data, target) => ({
      kind: "explorer-item",
      id: target.rowPath,
    }),
    getAppDragPreview: (data) => ({ text: data.fileName }),
  });
};
