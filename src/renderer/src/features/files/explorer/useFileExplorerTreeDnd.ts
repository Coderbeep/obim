import type { FileTreeDropResult, FileTree as FileTreeModel } from "@pierre/trees";
import { useStore } from "jotai";
import { useCallback, useRef } from "react";

import { useFileMove } from "../fileActions";
import { Notifications } from "@renderer/features/notifications/notifications";
import { addNotificationAtom } from "@renderer/store/NotificationsStore";
import {
  expandedDirectoriesAtom,
  fileTreeAtom,
  explorerSelectionPathsAtom,
  fileExplorerRevealRequestAtom,
} from "@renderer/store/fileExplorerStore";
import { getWorkspacePath } from "@renderer/config";
import { FILE_DRAG_DATA_MIME, type FileDragData } from "@shared/drag-data";
import { useAppDndActions } from "@renderer/shared/dnd/AppDndProvider";

import {
  buildExplorerTreeLookup,
  toRelativeDirectoryPath,
  getFileTreeMoveIntent,
  getTreeDropTargetFromHoveredPath,
  getTreePathName,
  getPdfAttachmentTarget,
  type TreeLookup,
} from "./fileExplorerTreeUtils";
import type { ExplorerTreeEventTarget } from "./tree/explorerTreeDom";
import { useExplorerTreeDnd } from "./tree/useExplorerTreeDnd";
import type { FileItem } from "@shared/file-item";
import { getRelativePathFromPath } from "@shared/pathUtils";

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
  const { attachManyToPdf, moveManyToDirectory } = useFileMove({ withPdfNotes: true });
  const rootDirectoryPath = getWorkspacePath();
  const dragFocusRef = useRef<{ path: string; ownedFocus: boolean } | null>(null);

  const finishMove = useCallback(
    (
      sourceItems: FileItem[],
      result: Awaited<ReturnType<typeof moveManyToDirectory>>,
      focus: typeof dragFocusRef.current,
    ) => {
      if (rootDirectoryPath !== getWorkspacePath()) return;
      const movedPaths = new Map(result.moved.map(({ file, movedPath }) => [file.path, movedPath]));
      store.set(
        explorerSelectionPathsAtom,
        sourceItems.map((item) => movedPaths.get(item.path) ?? item.path),
      );
      if (result.failures.length) {
        const items = store.get(fileTreeAtom);
        const latest = items.length ? buildExplorerTreeLookup(items) : lookupRef.current;
        model.resetPaths(latest.paths, {
          initialExpandedPaths: items.length
            ? latest.directoryTreePaths.filter((key) =>
                store.get(expandedDirectoriesAtom).has(toRelativeDirectoryPath(key)),
              )
            : expandedTreePaths,
        });
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          ...Notifications.FILE_MOVE_FAILED(result.moved.length, result.failures.length, result.failures[0].error),
          timestamp: Date.now(),
        });
      }
      const sourcePath = sourceItems.find((item) => item.path === focus?.path)?.path ?? sourceItems[0]?.path;
      if (sourcePath)
        store.set(fileExplorerRevealRequestAtom, {
          relativePath: getRelativePathFromPath(movedPaths.get(sourcePath) ?? sourcePath, rootDirectoryPath),
          preserveSelection: true,
          restoreFocus: focus?.ownedFocus ?? false,
        });
    },
    [expandedTreePaths, lookupRef, model, rootDirectoryPath, store],
  );

  const prepareMoveFocus = useCallback(
    (items: FileItem[], focus: typeof dragFocusRef.current) => {
      const source = items.find((item) => item.path === focus?.path) ?? items[0];
      if (source)
        store.set(fileExplorerRevealRequestAtom, {
          relativePath: getRelativePathFromPath(source.path, rootDirectoryPath),
          preserveSelection: true,
          restoreFocus: focus?.ownedFocus ?? false,
        });
    },
    [rootDirectoryPath, store],
  );

  const attachNotesToPdf = useCallback(
    async (notes: FileItem[], pdf: FileItem) => {
      const focus = dragFocusRef.current;
      store.set(
        explorerSelectionPathsAtom,
        notes.map((item) => item.path),
      );
      prepareMoveFocus(notes, focus);
      finishMove(notes, await attachManyToPdf(notes, pdf), focus);
    },
    [attachManyToPdf, finishMove, prepareMoveFocus, store],
  );

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

      const focus = dragFocusRef.current;
      prepareMoveFocus(intent.sourceItems, focus);
      const result = await moveManyToDirectory(intent.sourceItems, intent.absolutePath);
      finishMove(intent.sourceItems, result, focus);
    },
    [
      appDnd,
      enabled,
      expandedTreePaths,
      lookupRef,
      model,
      moveManyToDirectory,
      rootDirectoryPath,
      store,
      finishMove,
      prepareMoveFocus,
    ],
  );

  onDropCompleteRef.current = handleDropComplete;

  const getDraggedItemPreviewData = useCallback(
    (event: DragEvent, target: ExplorerTreeEventTarget): FileExplorerDragPreviewData | null => {
      const treePath = target.rowPath;
      const file = lookupRef.current.byTreePath.get(treePath);
      if (!file) return null;

      const { dataTransfer } = event;
      if (!dataTransfer) return null;

      const host = model.getFileTreeContainer();
      dragFocusRef.current = {
        path: file.path,
        ownedFocus: Boolean(
          host && (host.ownerDocument.activeElement === host || host.contains(host.ownerDocument.activeElement)),
        ),
      };

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
    [lookupRef, model],
  );

  const onTreeDragOver = useCallback(
    (_event: DragEvent, target: ExplorerTreeEventTarget | null) => {
      if (appDnd.getActiveEntity()?.kind !== "explorer-item") return;
      const lookup = lookupRef.current;
      // The PDF drop zone owns attachment validity and feedback, including leaf PDFs.
      if (getPdfAttachmentTarget(target?.rowPath ?? null, lookup)) return;
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

  const treeDnd = useExplorerTreeDnd({
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
  return { ...treeDnd, attachNotesToPdf };
};
