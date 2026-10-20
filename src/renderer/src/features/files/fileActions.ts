import { getWorkspaceTabBufferPaths } from "@renderer/store/workspaceBufferOwnership";
import {
  beginWorkspaceTransition,
  getWorkspaceTransitionGeneration,
  isWorkspaceTransitionActive,
  waitForWorkspaceActivity,
  WORKSPACE_TRANSITION_MESSAGE,
  type WorkspaceTransitionLease,
} from "@renderer/store/workspaceTransitionStore";
import { canLinkToSections, SECTION_LINK_FILENAME_MESSAGE } from "@shared/section-links";
import { createFileWorkspaceItem, isFileWorkspaceItem, type WorkspaceItem } from "@shared/workspace";
import {
  trashFile,
  saveFile,
  moveFile,
  movePdfNotes,
  readTextFile,
  renameFile,
  createFile,
  copyWorkspaceItems,
  importExternalFiles as importExternalFilesCommand,
  createDirectory as createDirectoryService,
} from "./workspaceFileService";
import {
  activePaneIdAtom,
  editorFocusRequestAtom,
  editorHeadingRequestAtom,
  workspacePanesAtom,
  workspaceNavigationRevisionAtom,
} from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "@renderer/store/editorTabStore";
import {
  applyBackgroundNoteLinkMoveAtom,
  applyNoteLinkUpdatesAtom,
  fileBuffersByPathAtom,
} from "@renderer/store/fileBufferStore";
import {
  hydrateFileBufferAtom,
  remapFileReferencesAtom,
  removeFileReferencesAtom,
} from "@renderer/store/fileLifecycleStore";
import {
  addRecentFile,
  fileAccessesAtom,
  fileTreeAtom,
  expandedDirectoriesAtom,
  fileExplorerRevealRequestAtom,
  explorerSelectionPathsAtom,
  pendingFileRenameAtom,
  recentFilesAtom,
  reloadRevisionAtom,
  renamingRequestAtom,
  type RenameTarget,
} from "@renderer/store/fileExplorerStore";
import { currentFileAtom, currentFilePathAtom } from "@renderer/store/workspaceResourceStore";
import { activateWorkspaceTabAtom, openWorkspaceResourceAtom } from "@renderer/store/workspaceActionStore";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { FileItem } from "@shared/file-item";
import type { AttachPdfNoteRequest, MovePdfWithNotesRequest } from "@shared/explorer-pdf-notes";
import { PDF_NOTES_SUFFIX } from "@shared/explorer-pdf-notes";
import { getRelativePathFromPath } from "@shared/pathUtils";
import { workspaceMutationApi } from "./workspaceMutationApi";
import {
  fileMoveRemapper,
  flattenFileTree,
  predictFileMove,
  predictPdfNotesMove,
  projectFileMoves,
  type FileMoveRoot,
} from "./optimisticFileMove";
import type { WorkspaceTextFile } from "@shared/file-operations";
import { isLargeTextFile } from "@shared/large-files";
import { isEditableFile, isPdfFile, isMarkdownFile } from "@shared/mime-types";
import { getWorkspacePath } from "@renderer/config";
import { filterTopLevelItems, findDirectoryNode, findItemNode, generateNumberedName } from "./fileTreeUtils";
import { resolveLinkedWorkspaceItem } from "./workspaceFileResolver";
import { Notifications } from "@renderer/features/notifications/notifications";
import {
  addNotificationAtom,
  notificationsAtom,
  NotificationLevel,
  type Notification,
  updateNotificationAtom,
} from "@renderer/store/NotificationsStore";
import { closeContextMenuAtom } from "@renderer/store/contextMenuStore";
import {
  pruneTaskBoardOrderAfterTrashes,
  remapTaskBoardOrderAfterFileMove,
  remapTaskBoardOrderAfterFileMoves,
} from "@renderer/features/workspace/taskBoardConfig";
import type { OpenWorkspaceItem, OpenWorkspaceItemOptions } from "@renderer/features/workspace/workspaceItemOperations";
import { saveBookmarks } from "./bookmarkPersistence";
import { useCallback } from "react";
import {
  basename,
  getExt,
  getPathWithoutFilename,
  isPathWithinBase,
  isValidFilename,
  joinFsPath,
  normalizeFileItemPath,
  remapPathAfterMove,
  stripLastExt,
  withExt,
} from "@shared/pathUtils";
import { saveDirtyFileBuffer, saveDirtyFileBuffers } from "./dirtyFileBuffers";
import { dispatchPdfDeepLink, parsePdfDeepLink, pdfReaderId } from "@renderer/shared/pdfDeepLink";

interface UseFileRemoveResult {
  remove: (file: FileItem) => Promise<boolean>;
  removeMany: (files: FileItem[]) => Promise<FileItem[]>;
}

interface UseFileOpenResult {
  openWorkspaceItem: OpenWorkspaceItem;
  open: (file: FileItem, options?: OpenWorkspaceItemOptions) => Promise<boolean>;
  openLinkedFile: (path: string, sourceFilePath?: string) => Promise<boolean>;
}

interface OpenLinkedFileRequest {
  path: string;
  sourceFilePath?: string;
  fileTree: FileItem[];
  openResource: (item: WorkspaceItem) => Promise<boolean>;
  notify: (notification: Notification) => void;
  requestHeading?: (filePath: string, fragment: string) => void;
}

interface UseFileRenameResult {
  startRenaming: (filePath: string, target?: RenameTarget) => void;
  saveRename: (oldFilePath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
  stopRenaming: (filePath: string) => void;
}

interface UseFileMoveResult {
  attachManyToPdf: (files: FileItem[], pdf: FileItem) => ReturnType<UseFileMoveResult["moveManyToDirectory"]>;
  moveToDirectory: (
    file: FileItem,
    targetDirectoryPath: string,
  ) => Promise<{ moved: boolean; movedPath?: string; error?: string }>;
  moveManyToDirectory: (
    files: FileItem[],
    targetDirectoryPath: string,
  ) => Promise<{
    moved: { file: FileItem; movedPath: string }[];
    failures: { file: FileItem; error: string }[];
  }>;
}

interface UseFileCreateResult {
  createPdfNote: (pdf: FileItem) => Promise<void>;
  createNewFile: (folderPath?: string) => Promise<void>;
  createMarkdownFile: (
    directoryPath: string,
    filename: string,
    content: string,
    openAfterCreation: boolean,
    options?: { numberOnCollision?: boolean; openInNewTab?: boolean },
  ) => Promise<FileItem | null>;
}

interface UseDirectoryCreateResult {
  createDirectory: (folderPath?: string) => Promise<void>;
}

interface UseExternalFileImportResult {
  importExternalFiles: (files: readonly File[], destinationDirectoryPath: string) => Promise<void>;
  importPdfNotes: (files: readonly File[], pdf: FileItem) => Promise<void>;
}

interface UseFileCopyResult {
  copyManyToDirectory: (files: FileItem[], destinationDirectoryPath: string) => Promise<void>;
}

interface UseManageFileBookmarkResult {
  addBookmark: (file: FileItem) => Promise<void>;
  removeBookmark: (file: FileItem) => Promise<void>;
  addBookmarks: (files: FileItem[]) => Promise<void>;
  removeBookmarks: (files: FileItem[]) => Promise<void>;
}

const isTextFile = (file: FileItem | null) => Boolean(file && isEditableFile(file.mimeType, file.path));
const notifyFileAlreadyExists = (store: ReturnType<typeof useStore>, filePath: string) => {
  store.set(addNotificationAtom, {
    id: crypto.randomUUID(),
    ...Notifications.FILE_ALREADY_EXISTS(filePath),
    timestamp: Date.now(),
  });
};
const notifyFileOperationError = (store: ReturnType<typeof useStore>, title: string, message: string, path?: string) =>
  store.set(addNotificationAtom, {
    id: crypto.randomUUID(),
    level: NotificationLevel.ERROR,
    title,
    message,
    path,
    timestamp: Date.now(),
  });
const notifyTaskOrderRepairFailed = (store: ReturnType<typeof useStore>) =>
  store.set(addNotificationAtom, {
    id: crypto.randomUUID(),
    level: NotificationLevel.ERROR,
    title: "Task order update failed",
    message: "The file operation succeeded. Task Board ordering will be reconciled when the layout is next saved.",
    timestamp: Date.now(),
  });
const summarizeErrors = (errors: string[]) =>
  errors.length === 1 ? errors[0] : `${errors[0]} (+${errors.length - 1} more)`;
const FILE_TRANSFER_INDICATOR_DELAY_MS = 250;

const isBufferAffectedByItem = (path: string, item: FileItem) =>
  path === item.path || (item.isDirectory && isPathWithinBase(path, item.path));

const withSavedLinkBuffers = async <T>(
  store: ReturnType<typeof useStore>,
  operation: (lease: WorkspaceTransitionLease) => Promise<T>,
  failed: (error: string) => T,
  background = false,
  optimistic?: { prepare: () => void; diskPath: (path: string) => string },
): Promise<T> => {
  const lease = beginWorkspaceTransition(store, "Updating note links…", background);
  if (!lease) return failed(WORKSPACE_TRANSITION_MESSAGE);
  try {
    optimistic?.prepare();
    await Promise.race([waitForWorkspaceActivity(), lease.cancellation]);
    if (lease.cancelled) return failed("Operation cancelled.");
    const saved = await saveDirtyFileBuffers(
      store,
      () => true,
      (path, content, version) => saveFile(optimistic?.diskPath(path) ?? path, content, version, lease),
      background,
    );
    if (!saved.success) return failed(saved.error);
    if (!lease.commit()) return failed("Operation cancelled.");
    return await operation(lease);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  } finally {
    lease.release();
  }
};

const saveDirtyBuffersForItems = (store: ReturnType<typeof useStore>, items: readonly FileItem[]) =>
  saveDirtyFileBuffers(store, (path) => items.some((item) => isBufferAffectedByItem(path, item)));

const useFileTransferIndicator = () => {
  const addNotification = useSetAtom(addNotificationAtom);
  const updateNotifications = useSetAtom(updateNotificationAtom);

  return useCallback(
    (notification: Omit<Notification, "id" | "timestamp">) => {
      const id = crypto.randomUUID();
      let visible = false;
      const timer = window.setTimeout(() => {
        visible = true;
        addNotification({ ...notification, id, timestamp: Date.now() });
      }, FILE_TRANSFER_INDICATOR_DELAY_MS);

      return () => {
        window.clearTimeout(timer);
        if (visible) {
          updateNotifications((current) => current.filter((item) => item.id !== id));
        }
      };
    },
    [addNotification, updateNotifications],
  );
};

const persistCurrentBookmarks = async (store: ReturnType<typeof useStore>) => {
  try {
    await saveBookmarks(store.get(bookmarksAtom));
  } catch (error) {
    console.error("Could not persist bookmarks:", error);
  }
};

type PdfNotesMoveOutcome = { success: boolean; newPath?: string; error?: string };

const optimisticFileMove = (
  store: ReturnType<typeof useStore>,
  previous: FileItem[],
  roots: FileMoveRoot[],
  workspace: string,
) => {
  const forward = fileMoveRemapper(roots);
  const reverse = fileMoveRemapper(
    roots.map((root) => ({ ...root, source: root.destination, destination: root.source })),
  );
  let applied = false;
  return {
    prepare: () => {
      const tree = projectFileMoves(previous, roots, workspace);
      applied = true;
      store.set(pendingFileRenameAtom, true);
      store.set(remapFileReferencesAtom, { notesDirectoryPath: workspace, remapPath: forward });
      store.set(fileTreeAtom, tree);
      store.set(renamingRequestAtom, null);
    },
    diskPath: reverse,
    rollback: () => {
      if (!applied) return;
      store.set(remapFileReferencesAtom, { notesDirectoryPath: workspace, remapPath: reverse });
      store.set(fileTreeAtom, previous);
      store.set(notificationsAtom, (current) =>
        current.map((notification) =>
          notification.path ? { ...notification, path: reverse(notification.path) } : notification,
        ),
      );
      store.set(pendingFileRenameAtom, false);
      applied = false;
    },
    reconcilePath: (actual: FileMoveRoot[]) => {
      const remap = fileMoveRemapper(actual);
      return (value: string) => remap(reverse(value));
    },
    settle: (actual: FileMoveRoot[], snapshot?: FileItem[]) => {
      const remap = fileMoveRemapper(actual);
      store.set(remapFileReferencesAtom, {
        notesDirectoryPath: workspace,
        remapPath: (value) => remap(reverse(value)),
      });
      store.set(fileTreeAtom, snapshot ?? projectFileMoves(previous, actual, workspace));
      applied = false;
    },
  };
};

/** Provisional paths are immediate; queued writes and link repair stay in the background. */
const performPdfNotesMove = async (
  store: ReturnType<typeof useStore>,
  request: MovePdfWithNotesRequest | AttachPdfNoteRequest,
): Promise<PdfNotesMoveOutcome> => {
  const root = getWorkspacePath();
  const previous = store.get(fileTreeAtom);
  const optimistic = optimisticFileMove(store, previous, predictPdfNotesMove(previous, request), root);
  store.set(closeContextMenuAtom);
  const failed = (error: string): PdfNotesMoveOutcome => {
    optimistic.rollback();
    notifyFileOperationError(
      store,
      "notePath" in request ? "Could not attach note" : "Could not move PDF and notes",
      error,
      request.pdfPath,
    );
    return { success: false, error };
  };
  return withSavedLinkBuffers(
    store,
    async (lease) => {
      try {
        const result = await movePdfNotes(request, lease);
        let snapshot: Awaited<ReturnType<Window["api"]["getExplorerSnapshot"]>> | undefined;
        try {
          snapshot = await window.api.getExplorerSnapshot();
        } catch {
          notifyFileOperationError(
            store,
            "Files could not be refreshed",
            "Refresh the explorer to see the current file locations.",
          );
        }
        const roots = result.success
          ? result.movedRoots
          : (result.recoveryPaths ?? []).filter(
              (entry) =>
                entry.sourceExists === false &&
                entry.destinationExists === true &&
                snapshot &&
                findItemNode(snapshot.items, entry.destination),
            );
        const moves = roots.map(({ source, destination }) => ({
          source,
          destination,
          directory:
            findItemNode(previous, source)?.isDirectory ??
            findItemNode(snapshot?.items ?? [], destination)?.isDirectory ??
            false,
        }));
        const reconcile = optimistic.reconcilePath(moves);
        const recoveryUpdates =
          !result.success && result.errorCode === "partial" && snapshot
            ? (
                await Promise.all(
                  Object.entries(store.get(fileBuffersByPathAtom)).map(async ([oldPath, buffer]) => {
                    const path = reconcile(oldPath);
                    const file = findItemNode(snapshot!.items, path);
                    if (!file || !isMarkdownFile(file.mimeType, path)) return null;
                    try {
                      const disk = await window.api.openTextFile(path);
                      return { path, previousContent: buffer.savedText, content: disk.content, version: disk.version };
                    } catch {
                      return null;
                    }
                  }),
                )
              ).filter((entry): entry is NonNullable<typeof entry> => entry !== null)
            : [];
        optimistic.settle(moves, snapshot?.items);
        const before = flattenFileTree(previous).filter((file) => !file.isDirectory);
        const actualRemap = fileMoveRemapper(moves);
        store.set(applyBackgroundNoteLinkMoveAtom, {
          updates: [...(result.linkUpdates ?? []), ...recoveryUpdates],
          move: result.success
            ? result.linkMove
            : {
                beforePaths: before.map((file) => file.relativePath),
                afterPaths: before.map((file) => getRelativePathFromPath(actualRemap(file.path), root)),
              },
          root,
        });
        lease.release();
        if (
          moves.length &&
          !(await remapTaskBoardOrderAfterFileMoves(
            moves.map((entry) => ({ fromPath: entry.source, toPath: entry.destination, directory: entry.directory })),
          ))
        )
          notifyTaskOrderRepairFailed(store);
        await persistCurrentBookmarks(store);
        if (!result.success) return failed(result.error);
        if ("notePath" in request) {
          store.set(
            expandedDirectoriesAtom,
            (current) => new Set([...current, getRelativePathFromPath(`${request.pdfPath}${PDF_NOTES_SUFFIX}`, root)]),
          );
          store.set(fileExplorerRevealRequestAtom, {
            relativePath: getRelativePathFromPath(result.output, root),
            preserveSelection: true,
          });
        }
        return { success: true, newPath: result.output };
      } finally {
        store.set(pendingFileRenameAtom, false);
        store.set(reloadRevisionAtom, (revision) => revision + 1);
      }
    },
    failed,
    true,
    optimistic,
  );
};

export const openLinkedFile = async ({
  path,
  sourceFilePath,
  fileTree,
  openResource,
  notify,
  requestHeading,
}: OpenLinkedFileRequest): Promise<boolean> => {
  const exactItem = resolveLinkedWorkspaceItem(path, fileTree, sourceFilePath, false);
  const deepLink = exactItem ? null : parsePdfDeepLink(path);
  const hash = deepLink || exactItem ? -1 : path.indexOf("#");
  const fragment = hash >= 0 ? path.slice(hash) : null;
  const targetPath = fragment
    ? path.slice(0, hash) || (sourceFilePath ? encodeURI(sourceFilePath).replace(/#/g, "%23") : "")
    : path;
  const item = exactItem ?? resolveLinkedWorkspaceItem(deepLink?.path ?? targetPath, fileTree, sourceFilePath);
  if (item) {
    if (
      fragment &&
      isFileWorkspaceItem(item) &&
      isMarkdownFile(item.file.mimeType, item.file.path) &&
      !canLinkToSections(item.file.path)
    ) {
      notify({
        id: crypto.randomUUID(),
        level: NotificationLevel.INFO,
        title: "Section links unavailable",
        message: SECTION_LINK_FILENAME_MESSAGE,
        timestamp: Date.now(),
      });
      return false;
    }
    const opened = await openResource(item);
    if (opened && deepLink && isFileWorkspaceItem(item) && isPdfFile(item.file.mimeType, item.file.path)) {
      window.setTimeout(() => dispatchPdfDeepLink({ ...deepLink, path: item.file.path }), 0);
    }
    if (opened && fragment && isFileWorkspaceItem(item) && isMarkdownFile(item.file.mimeType, item.file.path)) {
      requestHeading?.(item.file.path, fragment);
    }
    return opened;
  }

  notify({
    id: crypto.randomUUID(),
    ...Notifications.FILE_NOT_FOUND(path),
    timestamp: Date.now(),
  });
  return false;
};

let openRequestSequence = 0;
const pendingOpenRequestsByStore = new WeakMap<ReturnType<typeof useStore>, Map<string, number>>();

/**
 * Opens files in panes and keeps open-tab/editor/history state in sync.
 */
export const useFileOpen = (): UseFileOpenResult => {
  const store = useStore();

  const saveCurrentFile = useCallback(
    async (tabId: string | undefined) => {
      if (!tabId) return true;
      return (await saveDirtyFileBuffers(store, (path) => getWorkspaceTabBufferPaths(store.get, tabId).includes(path)))
        .success;
    },
    [store],
  );

  /**
   * Opens a workspace item in the requested pane/tab, optionally persisting the current file first.
   */
  const openWorkspaceItem = useCallback(
    async (item: WorkspaceItem, options?: OpenWorkspaceItemOptions) => {
      if (isWorkspaceTransitionActive()) return false;
      const {
        focusEditor = false,
        paneId,
        openInNewTab = false,
        targetTabId: requestedTabId,
        skipHistoryPush = false,
        historyDirection,
        skipSave = false,
      } = options ?? {};
      const workspacePath = getWorkspacePath();
      const workspaceGeneration = getWorkspaceTransitionGeneration();
      const targetPaneId =
        paneId ??
        (requestedTabId
          ? store.get(workspacePanesAtom).find((pane) => pane.tabs.includes(requestedTabId))?.id
          : undefined) ??
        store.get(activePaneIdAtom);
      const targetPane = store.get(workspacePanesAtom).find((pane) => pane.id === targetPaneId);
      if (!targetPane) return false;
      const targetTabId = requestedTabId ?? (openInNewTab ? undefined : (targetPane.activeTabId ?? undefined));
      const initialTab = targetTabId ? store.get(workspaceTabsByIdAtom)[targetTabId] : undefined;
      if (targetTabId && (!initialTab || !targetPane.tabs.includes(targetTabId))) return false;
      const isFileItem = isFileWorkspaceItem(item);
      const normalizedItem = isFileItem
        ? createFileWorkspaceItem(normalizeFileItemPath(item.file, item.file.path, getWorkspacePath()))
        : item;
      const filePath = isFileWorkspaceItem(normalizedItem) ? normalizedItem.file.path : "";
      const isText = isFileWorkspaceItem(normalizedItem) && isTextFile(normalizedItem.file);
      const isLargeText = isFileWorkspaceItem(normalizedItem) && isLargeTextFile(normalizedItem.file);
      const shouldGuardOpenRequest = !openInNewTab || Boolean(targetTabId);
      const openRequestKey = targetTabId ?? `empty:${targetPaneId}`;
      const pendingOpenRequestByTarget = pendingOpenRequestsByStore.get(store) ?? new Map<string, number>();
      pendingOpenRequestsByStore.set(store, pendingOpenRequestByTarget);
      store.set(workspaceNavigationRevisionAtom, (revision) => revision + 1);
      const openRequestId = ++openRequestSequence;
      if (shouldGuardOpenRequest) pendingOpenRequestByTarget.set(openRequestKey, openRequestId);

      const isCurrentOpenRequest = () =>
        !isWorkspaceTransitionActive() &&
        getWorkspaceTransitionGeneration() === workspaceGeneration &&
        getWorkspacePath() === workspacePath &&
        store
          .get(workspacePanesAtom)
          .some((pane) => pane.id === targetPaneId && (!targetTabId || pane.tabs.includes(targetTabId))) &&
        (!targetTabId || store.get(workspaceTabsByIdAtom)[targetTabId] === initialTab) &&
        (!shouldGuardOpenRequest || pendingOpenRequestByTarget.get(openRequestKey) === openRequestId);
      const clearOpenRequest = () => {
        if (shouldGuardOpenRequest && pendingOpenRequestByTarget.get(openRequestKey) === openRequestId)
          pendingOpenRequestByTarget.delete(openRequestKey);
      };

      try {
        if (!skipSave) {
          const saved = await saveCurrentFile(targetTabId ?? targetPane.activeTabId ?? undefined);
          if (!saved) return false;
          if (!isCurrentOpenRequest()) return false;
        }

        let fileToHydrate: WorkspaceTextFile | null = null;
        if (isText && !isLargeText && filePath && !store.get(fileBuffersByPathAtom)[filePath]) {
          const openResult = await readTextFile(filePath);
          if (!isCurrentOpenRequest()) return false;
          if (!openResult.success) {
            console.error("Error opening resource:", openResult.error);
            notifyFileOperationError(store, "Could not open file", openResult.error, filePath);
            return false;
          }
          fileToHydrate = { content: openResult.content, version: openResult.version };
        }

        if (!isCurrentOpenRequest()) return false;

        if (filePath && fileToHydrate) {
          store.set(hydrateFileBufferAtom, filePath, fileToHydrate.content, fileToHydrate.version);
        }

        store.set(openWorkspaceResourceAtom, {
          item: normalizedItem,
          paneId: targetPaneId,
          openInNewTab: openInNewTab || !targetTabId,
          targetTabId,
          skipHistoryPush,
          historyDirection,
          activate:
            !targetTabId ||
            (store.get(activePaneIdAtom) === targetPaneId &&
              store.get(workspacePanesAtom).find((pane) => pane.id === targetPaneId)?.activeTabId === targetTabId),
        });

        if (isFileWorkspaceItem(normalizedItem)) {
          store.set(recentFilesAtom, (prev) => addRecentFile(prev, normalizedItem.file));
          store.set(fileAccessesAtom, (accesses) => ({ ...accesses, [normalizedItem.file.path]: Date.now() }));
        }

        if (focusEditor && isText && !isLargeText) {
          store.set(editorFocusRequestAtom, (request) => ({
            filePath,
            paneId: targetPaneId,
            revision: (request?.revision ?? 0) + 1,
          }));
        }

        return true;
      } catch (err) {
        console.error("Error opening resource:", err);
        notifyFileOperationError(
          store,
          "Could not open file",
          err instanceof Error ? err.message : String(err),
          filePath || undefined,
        );
        return false;
      } finally {
        clearOpenRequest();
      }
    },
    [saveCurrentFile, store],
  );

  // Convenience wrapper around openWorkspaceItem for opening FileItems directly.
  // Designed for file explorer callers.
  const open = useCallback(
    async (file: FileItem, options?: OpenWorkspaceItemOptions) => {
      if (file.isDirectory) return false;

      try {
        return await openWorkspaceItem(createFileWorkspaceItem(file), options);
      } catch (err) {
        console.error("Error opening file:", err);
        return false;
      }
    },
    [openWorkspaceItem],
  );

  const openLinkedResource = useCallback(
    (path: string, sourceFilePath?: string) => {
      if (isWorkspaceTransitionActive()) return Promise.resolve(false);
      const deepLink = resolveLinkedWorkspaceItem(path, store.get(fileTreeAtom), sourceFilePath, false)
        ? null
        : parsePdfDeepLink(path);
      if (deepLink) {
        const item = resolveLinkedWorkspaceItem(deepLink.path, store.get(fileTreeAtom), sourceFilePath);
        if (item && isFileWorkspaceItem(item) && isPdfFile(item.file.mimeType, item.file.path)) {
          const panes = store.get(workspacePanesAtom);
          const activePaneId = store.get(activePaneIdAtom) || panes[0]?.id;
          const tabs = store.get(workspaceTabsByIdAtom);
          // Prefer the active reader, then another tab in its pane, then stable pane/tab order.
          const orderedPanes = [
            ...panes.filter((pane) => pane.id === activePaneId),
            ...panes.filter((pane) => pane.id !== activePaneId),
          ];
          for (const pane of orderedPanes) {
            const orderedTabs = [
              ...(pane.activeTabId ? [pane.activeTabId] : []),
              ...pane.tabs.filter((id) => id !== pane.activeTabId),
            ];
            const tab = orderedTabs
              .map((id) => tabs[id])
              .find((candidate) => candidate?.currentResourceKey === item.key);
            if (!tab) continue;
            store.set(activateWorkspaceTabAtom, { paneId: pane.id, tabId: tab.id });
            dispatchPdfDeepLink({
              ...deepLink,
              path: item.file.path,
              readerId: pdfReaderId(pane.id, tab.currentResourceKey),
            });
            return Promise.resolve(true);
          }
          return openWorkspaceItem(item).then((opened) => {
            if (opened && activePaneId)
              dispatchPdfDeepLink({ ...deepLink, path: item.file.path, readerId: pdfReaderId(activePaneId, item.key) });
            return opened;
          });
        }
      }
      return openLinkedFile({
        path,
        sourceFilePath,
        fileTree: store.get(fileTreeAtom),
        openResource: openWorkspaceItem,
        notify: (notification) => store.set(addNotificationAtom, notification),
        requestHeading: (filePath, fragment) =>
          store.set(editorHeadingRequestAtom, {
            filePath,
            fragment,
            paneId: store.get(activePaneIdAtom) || store.get(workspacePanesAtom)[0]?.id || "",
            revision: Date.now(),
          }),
      });
    },
    [openWorkspaceItem, store],
  );

  return { openWorkspaceItem, open, openLinkedFile: openLinkedResource };
};

/**
 * Removes files/directories and prunes all state entries that reference them.
 */
export const useFileRemove = (): UseFileRemoveResult => {
  const store = useStore();
  const setReloadRevision = useSetAtom(reloadRevisionAtom);

  const removeMany = async (files: FileItem[]) => {
    if (files.length === 0) return [];

    const candidates = filterTopLevelItems(files);
    store.set(closeContextMenuAtom);

    const saved = await saveDirtyBuffersForItems(store, candidates);
    if (!saved.success) return [];

    const removedItems: FileItem[] = [];
    const failures: string[] = [];
    const results = await Promise.all(candidates.map(async (file) => ({ file, result: await trashFile(file.path) })));
    for (const { file, result } of results) {
      if (result.success) {
        removedItems.push(file);
      } else {
        failures.push(`${basename(file.path)}: ${result.error}`);
      }
    }
    if (
      removedItems.length &&
      !(await pruneTaskBoardOrderAfterTrashes(
        removedItems.map((file) => ({ path: file.path, directory: file.isDirectory })),
      ))
    )
      notifyTaskOrderRepairFailed(store);

    if (failures.length)
      store.set(addNotificationAtom, {
        id: crypto.randomUUID(),
        level: NotificationLevel.ERROR,
        title: "Could not move file to Trash",
        message: summarizeErrors(failures),
        timestamp: Date.now(),
      });

    if (removedItems.length > 0) {
      store.set(removeFileReferencesAtom, { removedItems, notesDirectoryPath: getWorkspacePath() });
      await persistCurrentBookmarks(store);
      setReloadRevision((revision) => revision + 1);
    }

    return removedItems;
  };

  const remove = async (file: FileItem) => {
    return (await removeMany([file])).length > 0;
  };

  return { remove, removeMany };
};

/**
 * Manages rename mode UI state and persists file/directory rename operations.
 */
export const useFileRename = (options: { withPdfNotes?: boolean } = {}): UseFileRenameResult => {
  const store = useStore();
  const startRenaming = (filePath: string, target: RenameTarget = "explorer") => {
    if (!filePath) return;
    store.set(renamingRequestAtom, { filePath, target });
  };

  const saveRename = async (oldFilePath: string, newName: string) => {
    const prevTree = store.get(fileTreeAtom);
    const oldItem = findItemNode(prevTree, oldFilePath);
    if (!oldItem) return { success: false as const, error: "Source file not found" };

    const trimmedName = newName.trim();
    if (!isValidFilename(trimmedName)) return { success: false as const, error: "Invalid filename" };

    const ext = oldItem.isDirectory ? "" : getExt(oldFilePath);
    const finalName = oldItem.isDirectory ? trimmedName : withExt(trimmedName, ext || ".md");
    const requestedPath = joinFsPath(getPathWithoutFilename(oldFilePath), finalName);
    if (requestedPath === oldFilePath) return { success: true as const, newPath: oldFilePath };
    if (findItemNode(prevTree, requestedPath)) {
      notifyFileAlreadyExists(store, requestedPath);
      return { success: false as const, error: "Destination file already exists" };
    }
    if (options.withPdfNotes && isPdfFile(oldItem.mimeType, oldItem.path)) {
      return performPdfNotesMove(store, {
        pdfPath: oldItem.path,
        destinationDirectoryPath: getPathWithoutFilename(oldItem.path),
        newFilename: finalName,
      });
    }
    const notesDirectoryPath = getWorkspacePath();
    const diskPath = (path: string) => remapPathAfterMove(path, requestedPath, oldFilePath, oldItem.isDirectory);
    let optimisticApplied = false;
    let committed = false;
    const rollback = () => {
      if (!optimisticApplied || committed) return;
      store.set(remapFileReferencesAtom, { remapPath: diskPath, notesDirectoryPath, includeTree: true });
      store.set(notificationsAtom, (notifications) =>
        notifications.map((notification) =>
          notification.path ? { ...notification, path: diskPath(notification.path) } : notification,
        ),
      );
      optimisticApplied = false;
      store.set(pendingFileRenameAtom, false);
    };

    store.set(closeContextMenuAtom);
    const outcome = await withSavedLinkBuffers(
      store,
      async (lease) => {
        const result = await renameFile(oldFilePath, finalName, lease);
        if (!result.success) {
          rollback();
          store.set(applyNoteLinkUpdatesAtom, result.linkUpdates ?? []);
          if (result.error === "Destination file already exists") {
            notifyFileAlreadyExists(store, joinFsPath(getPathWithoutFilename(oldFilePath), finalName));
          }
          return { success: false as const, error: result.error };
        }

        const newPath = result.output || oldFilePath;
        committed = true;
        if (newPath !== requestedPath) {
          const remapPath = (path: string) => remapPathAfterMove(path, requestedPath, newPath, oldItem.isDirectory);
          store.set(remapFileReferencesAtom, { remapPath, notesDirectoryPath, includeTree: true });
        }
        if (result.linkMove) {
          store.set(applyBackgroundNoteLinkMoveAtom, {
            updates: result.linkUpdates ?? [],
            move: result.linkMove,
            root: notesDirectoryPath,
          });
        } else store.set(applyNoteLinkUpdatesAtom, result.linkUpdates ?? []);
        lease.release();
        if (!(await remapTaskBoardOrderAfterFileMove(oldFilePath, newPath, oldItem.isDirectory)))
          notifyTaskOrderRepairFailed(store);
        await persistCurrentBookmarks(store);
        store.set(reloadRevisionAtom, (revision) => revision + 1);
        return { success: true as const, newPath };
      },
      (error) => {
        rollback();
        return { success: false as const, error };
      },
      true,
      {
        prepare: () => {
          optimisticApplied = true;
          store.set(pendingFileRenameAtom, true);
          store.set(remapFileReferencesAtom, {
            remapPath: (path) => remapPathAfterMove(path, oldFilePath, requestedPath, oldItem.isDirectory),
            notesDirectoryPath,
            includeTree: true,
          });
          store.set(renamingRequestAtom, null);
        },
        diskPath,
      },
    );
    if (optimisticApplied || committed) store.set(pendingFileRenameAtom, false);
    if (
      !outcome.success &&
      outcome.error !== "Destination file already exists" &&
      !store
        .get(notificationsAtom)
        .some(
          (notification) =>
            notification.level === NotificationLevel.ERROR &&
            notification.message === outcome.error &&
            notification.path === oldFilePath,
        )
    )
      notifyFileOperationError(store, "Rename failed", outcome.error, oldFilePath);
    return outcome;
  };

  const stopRenaming = (filePath: string) => {
    store.set(renamingRequestAtom, (prev) => (prev?.filePath === filePath ? null : prev));
  };

  return { startRenaming, saveRename, stopRenaming };
};

/**
 * Moves a file/directory and mirrors the path change across open editor state.
 */
export const useFileMove = (options: { withPdfNotes?: boolean } = {}): UseFileMoveResult => {
  const store = useStore();

  const moveItemToDirectory = useCallback(
    async (file: FileItem, targetDirectoryPath: string, repairTaskBoardOrder = true) => {
      if (options.withPdfNotes && !file.isDirectory && isPdfFile(file.mimeType, file.path)) {
        const result = await performPdfNotesMove(store, {
          pdfPath: file.path,
          destinationDirectoryPath: targetDirectoryPath,
        });
        return { moved: result.success, movedPath: result.newPath, error: result.error };
      }
      const root = getWorkspacePath();
      const previous = store.get(fileTreeAtom);
      const optimistic = optimisticFileMove(
        store,
        previous,
        predictFileMove(previous, file, targetDirectoryPath),
        root,
      );
      return withSavedLinkBuffers(
        store,
        async (lease) => {
          try {
            const result = await moveFile(file.path, targetDirectoryPath, lease);
            if (!result.success) {
              optimistic.rollback();
              store.set(applyNoteLinkUpdatesAtom, result.linkUpdates ?? []);
              return { moved: false, error: result.error };
            }
            const movedPath = result.output;
            optimistic.settle([{ source: file.path, destination: movedPath, directory: file.isDirectory }]);
            if (result.linkMove)
              store.set(applyBackgroundNoteLinkMoveAtom, {
                updates: result.linkUpdates ?? [],
                move: result.linkMove,
                root,
              });
            else store.set(applyNoteLinkUpdatesAtom, result.linkUpdates ?? []);
            lease.release();
            if (
              repairTaskBoardOrder &&
              !(await remapTaskBoardOrderAfterFileMove(file.path, movedPath, file.isDirectory))
            )
              notifyTaskOrderRepairFailed(store);
            return { moved: true, movedPath };
          } finally {
            store.set(pendingFileRenameAtom, false);
          }
        },
        (error) => {
          optimistic.rollback();
          return { moved: false, error };
        },
        true,
        optimistic,
      );
    },
    [options.withPdfNotes, store],
  );

  const moveToDirectory = useCallback(
    async (file: FileItem, targetDirectoryPath: string) => {
      const result = await moveItemToDirectory(file, targetDirectoryPath);
      if (result.moved) {
        await persistCurrentBookmarks(store);
        store.set(reloadRevisionAtom, (revision) => revision + 1);
      }
      return result;
    },
    [moveItemToDirectory, options.withPdfNotes, store],
  );

  const moveManyToDirectory = useCallback(
    async (files: FileItem[], targetDirectoryPath: string) => {
      const moved: { file: FileItem; movedPath: string }[] = [];
      const failures: { file: FileItem; error: string }[] = [];

      const results: { file: FileItem; result: Awaited<ReturnType<typeof moveItemToDirectory>> }[] = [];
      const selectedPdfs = options.withPdfNotes
        ? files.filter((file) => !file.isDirectory && isPdfFile(file.mimeType, file.path))
        : [];
      for (const file of filterTopLevelItems(files).filter(
        (file) => !selectedPdfs.some((pdf) => isPathWithinBase(file.path, `${pdf.path}${PDF_NOTES_SUFFIX}`)),
      )) {
        results.push({ file, result: await moveItemToDirectory(file, targetDirectoryPath, false) });
      }
      for (const { file, result } of results) {
        if (result.moved && result.movedPath) moved.push({ file, movedPath: result.movedPath });
        else failures.push({ file, error: result.error ?? `Could not move ${file.filename}` });
      }

      if (moved.length) {
        if (
          !(await remapTaskBoardOrderAfterFileMoves(
            moved.map(({ file, movedPath }) => ({
              fromPath: file.path,
              toPath: movedPath,
              directory: file.isDirectory,
            })),
          ))
        )
          notifyTaskOrderRepairFailed(store);
        await persistCurrentBookmarks(store);
        store.set(reloadRevisionAtom, (revision) => revision + 1);
      }
      return { moved, failures };
    },
    [moveItemToDirectory, options.withPdfNotes, store],
  );

  const attachManyToPdf = useCallback(
    async (files: FileItem[], pdf: FileItem) => {
      const moved: { file: FileItem; movedPath: string }[] = [];
      const failures: { file: FileItem; error: string }[] = [];
      for (const file of filterTopLevelItems(files)) {
        const result = await performPdfNotesMove(store, { pdfPath: pdf.path, notePath: file.path });
        if (result.success && result.newPath) moved.push({ file, movedPath: result.newPath });
        else failures.push({ file, error: result.error ?? `Could not attach ${file.filename}` });
      }
      return { moved, failures };
    },
    [store],
  );

  return { attachManyToPdf, moveManyToDirectory, moveToDirectory };
};

/**
 * Creates a new note in a target folder and opens it in a dedicated tab.
 */
export const useFileCreate = (): UseFileCreateResult => {
  const store = useStore();
  const { open } = useFileOpen();

  const getFiles = () => store.get(fileTreeAtom);
  const requestReload = () => store.set(reloadRevisionAtom, (revision) => revision + 1);

  const getCurrentFilename = () => store.get(currentFilePathAtom);
  const saveCurrentFile = async () => {
    const currentFilename = getCurrentFilename();
    const currentFile = store.get(currentFileAtom);

    if (!currentFilename) return true;
    if (!isTextFile(currentFile) || (currentFile && isLargeTextFile(currentFile))) return true;

    const buffer = store.get(fileBuffersByPathAtom)[currentFilename];
    return !buffer || (await saveDirtyFileBuffer(store, currentFilename, buffer.editorText)).success;
  };

  const createMarkdownFile = async (
    directoryPath: string,
    filename: string,
    content: string,
    openAfterCreation: boolean,
    options: { numberOnCollision?: boolean; openInNewTab?: boolean } = {},
  ) => {
    const openInNewTab = options.openInNewTab ?? true;
    if (!(await saveCurrentFile())) return null;

    const extension = getExt(filename);
    const baseName = stripLastExt(filename);
    let collisionIndex = 1;
    let created: Awaited<ReturnType<typeof createFile>>;
    do {
      const candidate = collisionIndex === 1 ? filename : `${baseName} ${collisionIndex}${extension}`;
      created = await createFile(directoryPath, candidate, content);
      collisionIndex += 1;
    } while (!created.success && created.error === "Destination file already exists" && options.numberOnCollision);
    if (!created.success) {
      notifyFileOperationError(store, "Could not create note", created.error, joinFsPath(directoryPath, filename));
      return null;
    }

    requestReload();
    if (openAfterCreation) await open(created.file, { openInNewTab, skipSave: true });
    return created.file;
  };

  const createNewFile = async (folderPath: string = getWorkspacePath()) => {
    let filename: string;
    const files = getFiles();

    if (folderPath === getWorkspacePath()) {
      filename = generateNumberedName(files, "Untitled", ".md");
    } else {
      const targetFolder = findDirectoryNode(files, folderPath);
      if (!targetFolder) return;

      filename = generateNumberedName(targetFolder.children || [], "Untitled", ".md");
    }

    const created = await createMarkdownFile(folderPath, filename, "", true);
    if (created && store.get(currentFilePathAtom) === created.path) {
      store.set(renamingRequestAtom, { filePath: created.path, target: "note-header" });
    }
  };

  const createPdfNote = async (pdf: FileItem) => {
    const generation = getWorkspaceTransitionGeneration();
    const root = getWorkspacePath();
    if (pdf.isDirectory || !isPdfFile(pdf.mimeType, pdf.path) || !(await saveCurrentFile())) return;
    const companionPath = `${pdf.path}${PDF_NOTES_SUFFIX}`;
    const companion = findDirectoryNode(getFiles(), companionPath);
    const filename = generateNumberedName(companion?.children ?? [], "Untitled", ".md");
    try {
      if (typeof window.api.createPdfNote !== "function")
        throw new Error("Restart obim to enable PDF notes operations.");
      const result = await workspaceMutationApi.createPdfNote({ pdfPath: pdf.path, filename, content: "" });
      if (!result.success) {
        notifyFileOperationError(store, "Could not create note", result.error, pdf.path);
        requestReload();
        return;
      }
      let snapshot: Awaited<ReturnType<Window["api"]["getExplorerSnapshot"]>> | undefined;
      try {
        snapshot = await window.api.getExplorerSnapshot();
      } catch {
        notifyFileOperationError(
          store,
          "Note created",
          "The note was saved. Refresh the explorer to see its location.",
          result.file.path,
        );
      }
      if (generation !== getWorkspaceTransitionGeneration() || root !== getWorkspacePath()) return;
      if (snapshot) store.set(fileTreeAtom, snapshot.items);
      const relativeCompanion = `${pdf.relativePath}${PDF_NOTES_SUFFIX}`;
      store.set(expandedDirectoriesAtom, (paths) => new Set([...paths, relativeCompanion]));
      store.set(fileExplorerRevealRequestAtom, { relativePath: result.file.relativePath });
      requestReload();
      await open(result.file, { openInNewTab: true, skipSave: true });
      store.set(renamingRequestAtom, { filePath: result.file.path, target: "note-header" });
    } catch (error) {
      requestReload();
      notifyFileOperationError(
        store,
        "Could not create note",
        error instanceof Error ? error.message : String(error),
        pdf.path,
      );
    }
  };
  return { createMarkdownFile, createNewFile, createPdfNote };
};

/**
 * Creates a new directory in a target folder and immediately enters rename mode.
 */
export const useDirectoryCreate = (): UseDirectoryCreateResult => {
  const store = useStore();
  const files = useAtomValue(fileTreeAtom);
  const setReloadRevision = useSetAtom(reloadRevisionAtom);
  const setRenamingRequest = useSetAtom(renamingRequestAtom);

  const createDirectory = async (folderPath: string = getWorkspacePath()) => {
    let foldername: string;

    if (folderPath === getWorkspacePath()) {
      foldername = generateNumberedName(files, "New folder");
    } else {
      const targetFolder = findDirectoryNode(files, folderPath);
      if (!targetFolder) return;
      foldername = generateNumberedName(targetFolder.children || [], "New folder");
    }

    const created = await createDirectoryService(folderPath, foldername);
    if (!created.success) {
      notifyFileOperationError(store, "Could not create folder", created.error, joinFsPath(folderPath, foldername));
      return;
    }

    setRenamingRequest({ filePath: created.directory!.path, target: "explorer" });
    setReloadRevision((revision) => revision + 1);
  };

  return { createDirectory };
};

/**
 * Imports external files, refreshes the files view, and reports the command result.
 */
export const useExternalFileImport = (): UseExternalFileImportResult => {
  const store = useStore();
  const setReloadRevision = useSetAtom(reloadRevisionAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  const showTransferIndicator = useFileTransferIndicator();

  const importFiles = useCallback(
    async (files: readonly File[], destinationDirectoryPath: string, pdf?: FileItem) => {
      const root = getWorkspacePath();
      const generation = getWorkspaceTransitionGeneration();
      const hideTransferIndicator = showTransferIndicator(
        Notifications.FILES_IMPORTING(files.length, basename(destinationDirectoryPath) || "workspace"),
      );
      try {
        if (pdf && typeof window.api.importPdfNotes !== "function")
          throw new Error("Restart obim to enable PDF notes operations.");
        const result = pdf
          ? await workspaceMutationApi.importPdfNotes(files, pdf.path)
          : await importExternalFilesCommand(files, destinationDirectoryPath);

        if (pdf && (root !== getWorkspacePath() || generation !== getWorkspaceTransitionGeneration())) return;

        if (result.importedPaths.length) {
          if (pdf) {
            try {
              const snapshot = await window.api.getExplorerSnapshot();
              if (root !== getWorkspacePath() || generation !== getWorkspaceTransitionGeneration()) return;
              store.set(fileTreeAtom, snapshot.items);
            } catch {
              // The regular reload below can retry without misreporting a successful import.
            }
            store.set(
              expandedDirectoriesAtom,
              (current) => new Set([...current, getRelativePathFromPath(`${pdf.path}${PDF_NOTES_SUFFIX}`, root)]),
            );
            store.set(explorerSelectionPathsAtom, result.importedPaths);
            store.set(fileExplorerRevealRequestAtom, {
              relativePath: getRelativePathFromPath(result.importedPaths[0], root),
              preserveSelection: true,
            });
          }
          setReloadRevision((revision) => revision + 1);
          addNotification({
            id: crypto.randomUUID(),
            ...Notifications.FILES_IMPORTED(result.importedPaths.length),
            timestamp: Date.now(),
          });
        }

        if (result.errors.length) {
          addNotification({
            id: crypto.randomUUID(),
            ...Notifications.FILE_IMPORT_FAILED(summarizeErrors(result.errors)),
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        addNotification({
          id: crypto.randomUUID(),
          ...Notifications.FILE_IMPORT_FAILED(error instanceof Error ? error.message : String(error)),
          timestamp: Date.now(),
        });
      } finally {
        hideTransferIndicator();
      }
    },
    [addNotification, setReloadRevision, showTransferIndicator, store],
  );

  const importExternalFiles = useCallback(
    (files: readonly File[], directory: string) => importFiles(files, directory),
    [importFiles],
  );
  const importPdfNotes = useCallback(
    (files: readonly File[], pdf: FileItem) => importFiles(files, pdf.path, pdf),
    [importFiles],
  );
  return { importExternalFiles, importPdfNotes };
};

/** Copies workspace items, refreshes the files view, and reports partial failures. */
export const useFileCopy = (): UseFileCopyResult => {
  const store = useStore();
  const setReloadRevision = useSetAtom(reloadRevisionAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  const showTransferIndicator = useFileTransferIndicator();

  const copyManyToDirectory = useCallback(
    async (files: FileItem[], destinationDirectoryPath: string) => {
      const lease = beginWorkspaceTransition(store, "Copying files…");
      if (!lease) {
        addNotification({
          id: crypto.randomUUID(),
          ...Notifications.FILE_COPY_FAILED(WORKSPACE_TRANSITION_MESSAGE),
          timestamp: Date.now(),
        });
        return;
      }
      const hideTransferIndicator = showTransferIndicator(
        Notifications.FILES_PASTING(files.length, basename(destinationDirectoryPath) || "workspace"),
      );
      try {
        await Promise.race([waitForWorkspaceActivity(), lease.cancellation]);
        if (lease.cancelled) return;
        const prepared = await saveDirtyFileBuffers(
          store,
          (path) => files.some((file) => isBufferAffectedByItem(path, file)),
          (path, content, version) => saveFile(path, content, version, lease),
        );
        if (!prepared.success || !lease.commit()) return;
        const result = await copyWorkspaceItems(
          files.map((file) => file.path),
          destinationDirectoryPath,
          lease,
        );

        if (result.copiedPaths.length) {
          setReloadRevision((revision) => revision + 1);
          addNotification({
            id: crypto.randomUUID(),
            ...Notifications.FILES_COPIED(result.copiedPaths.length),
            timestamp: Date.now(),
          });
        }

        if (result.errors.length) {
          addNotification({
            id: crypto.randomUUID(),
            ...Notifications.FILE_COPY_FAILED(summarizeErrors(result.errors)),
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        addNotification({
          id: crypto.randomUUID(),
          ...Notifications.FILE_COPY_FAILED(error instanceof Error ? error.message : String(error)),
          timestamp: Date.now(),
        });
      } finally {
        lease.release();
        hideTransferIndicator();
      }
    },
    [addNotification, setReloadRevision, showTransferIndicator, store],
  );

  return { copyManyToDirectory };
};

/**
 * Adds/removes file bookmarks in storage and mirrors the bookmark atom state.
 */
export const useManageFileBookmark = (): UseManageFileBookmarkResult => {
  const store = useStore();

  const addBookmarks = async (files: FileItem[]) => {
    const candidates = Array.from(
      files
        .reduce((byPath, file) => {
          if (!file.isDirectory) byPath.set(file.path, file);
          return byPath;
        }, new Map<string, FileItem>())
        .values(),
    );

    if (candidates.length === 0) return;

    const bookmarks = store.get(bookmarksAtom);
    const alreadyKnown = new Set(bookmarks.map((bookmark) => bookmark.path));
    const toAdd = candidates.filter((file) => !alreadyKnown.has(file.path));

    if (toAdd.length === 0) return;

    const next = [...bookmarks, ...toAdd];
    await saveBookmarks(next);
    store.set(bookmarksAtom, next);
  };

  const addBookmark = async (file: FileItem) => {
    await addBookmarks([file]);
  };

  const removeBookmarks = async (files: FileItem[]) => {
    const candidates = Array.from(
      files
        .reduce((byPath, file) => {
          if (!file.isDirectory) byPath.set(file.path, file);
          return byPath;
        }, new Map<string, FileItem>())
        .values(),
    );

    if (candidates.length === 0) return;

    const removedPaths = new Set(candidates.map((file) => file.path));
    const current = store.get(bookmarksAtom);
    const next = current.filter((bookmark) => !removedPaths.has(bookmark.path));
    if (next.length === current.length) return;

    await saveBookmarks(next);
    store.set(bookmarksAtom, next);
  };

  const removeBookmark = async (file: FileItem) => {
    await removeBookmarks([file]);
  };

  return { addBookmark, removeBookmark, addBookmarks, removeBookmarks };
};
