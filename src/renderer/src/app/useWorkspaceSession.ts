import { fileLoadStatesByPathAtom, type FileLoadState } from "@renderer/store/fileLoadStore";
import { basename, getRelativePathFromPath, isPathWithinBase } from "@shared/pathUtils";
import { getWorkspacePath } from "@renderer/config";
import {
  workspaceTransitionAtom,
  isWorkspaceTransitionActive,
  getWorkspaceTransitionGeneration,
  runWorkspaceMutation,
} from "@renderer/store/workspaceTransitionStore";
import { useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useState } from "react";

import { readTextFile } from "@renderer/features/files/workspaceFileService";
import {
  activePaneIdAtom,
  createWorkspacePane,
  workspacePanesAtom,
  workspaceNavigationRevisionAtom,
} from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom, type WorkspaceTabState } from "@renderer/store/editorTabStore";
import { hydrateFileBufferAtom } from "@renderer/store/fileLifecycleStore";
import {
  expandedDirectoriesAtom,
  explorerSectionSizesAtom,
  explorerSectionsAtom,
  fileAccessesAtom,
  fileTreeAtom,
  fileTreeLoadStateAtom,
  recentFilesAtom,
} from "@renderer/store/fileExplorerStore";
import { taskBoardPreferencesAtom } from "@renderer/store/taskBoardPreferencesStore";
import { normalizeWorkspacePaneSizes } from "@renderer/store/workspaceTransitions";
import { openWorkspaceItemsByKeyAtom } from "@renderer/store/workspaceResourceStore";
import type { FileItem } from "@shared/file-item";
import { isLargeTextFile } from "@shared/large-files";
import { isEditableFile } from "@shared/mime-types";
import {
  createFileWorkspaceItem,
  getWorkspaceFilePathFromKey,
  isFileWorkspaceItem,
  restoreStaticWorkspaceItem,
  type WorkspaceItem,
} from "@shared/workspace";
import {
  MAX_WORKSPACE_SESSION_FILE_ACCESSES,
  MAX_WORKSPACE_SESSION_RECENT_FILES,
  WORKSPACE_SESSION_VERSION,
  type WorkspaceSession,
} from "@shared/workspace-session";

const SAVE_DELAY_MS = 350;

const flattenTree = (items: readonly FileItem[]): FileItem[] =>
  items.flatMap((item) => [item, ...(item.isDirectory ? flattenTree(item.children ?? []) : [])]);

export const restoreWorkspaceSession = (
  session: WorkspaceSession,
  fileTree: readonly FileItem[],
  workspacePath?: string,
) => {
  const allItems = flattenTree(fileTree);
  const filesByPath = new Map(allItems.filter((item) => !item.isDirectory).map((file) => [file.path, file]));
  const directories = new Set(
    allItems.filter((item) => item.isDirectory).map((directory) => directory.relativePath.replaceAll("\\", "/")),
  );
  const itemsByKey: Record<string, WorkspaceItem> = {};
  const fileItemsByKey = new Map(
    [...filesByPath.values()].map((file) => {
      const item = createFileWorkspaceItem(file);
      return [item.key, item] as const;
    }),
  );

  const resolveKey = (key: string, preserveMissing = false) => {
    const staticItem = restoreStaticWorkspaceItem(key);
    if (staticItem) {
      itemsByKey[key] = staticItem;
      return true;
    }
    const fileItem = fileItemsByKey.get(key);
    if (fileItem) {
      itemsByKey[key] = fileItem;
      return true;
    }
    const missingPath = preserveMissing ? getWorkspaceFilePathFromKey(key) : null;
    if (
      missingPath &&
      (isEditableFile(undefined, missingPath) || /\.txt$/i.test(missingPath)) &&
      (!workspacePath || isPathWithinBase(missingPath, workspacePath))
    ) {
      itemsByKey[key] = createFileWorkspaceItem({
        id: missingPath,
        path: missingPath,
        filename: basename(missingPath),
        relativePath: workspacePath ? getRelativePathFromPath(missingPath, workspacePath) : basename(missingPath),
        isDirectory: false,
        mimeType: "text/plain",
      });
      return true;
    }
    return false;
  };

  const tabsById: Record<string, WorkspaceTabState> = {};
  const seenTabs = new Set<string>();
  for (const tab of session.tabs) {
    if (seenTabs.has(tab.id) || !resolveKey(tab.currentResourceKey, true)) continue;
    const backStack = tab.backStack.filter((key) => resolveKey(key));
    const forwardStack = tab.forwardStack.filter((key) => resolveKey(key));
    tabsById[tab.id] = {
      id: tab.id,
      currentResourceKey: tab.currentResourceKey,
      backStack: backStack.length ? backStack : [tab.currentResourceKey],
      forwardStack,
    };
    seenTabs.add(tab.id);
  }

  const assignedTabs = new Set<string>();
  const seenPanes = new Set<string>();
  const panes = session.panes.flatMap((pane) => {
    if (seenPanes.has(pane.id)) return [];
    seenPanes.add(pane.id);
    const tabs = pane.tabs.filter(
      (tabId) => tabsById[tabId] && !assignedTabs.has(tabId) && Boolean(assignedTabs.add(tabId)),
    );
    return [
      {
        id: pane.id,
        tabs,
        activeTabId: pane.activeTabId && tabs.includes(pane.activeTabId) ? pane.activeTabId : (tabs[0] ?? null),
        size: pane.size,
      },
    ];
  });
  const restoredPanes = normalizeWorkspacePaneSizes(panes.length ? panes : [createWorkspacePane("pane-1")]);
  const assignedTabsById = Object.fromEntries(Object.entries(tabsById).filter(([tabId]) => assignedTabs.has(tabId)));

  return {
    activePaneId: restoredPanes.some((pane) => pane.id === session.activePaneId)
      ? session.activePaneId
      : restoredPanes[0].id,
    expandedDirectories: new Set(
      session.expandedDirectories
        .map((directory) => directory.replaceAll("\\", "/"))
        .filter((directory) => directories.has(directory)),
    ),
    explorerSections: session.explorerSections,
    explorerSectionSizes: session.explorerSectionSizes,
    fileAccesses: Object.fromEntries(Object.entries(session.fileAccesses).filter(([path]) => filesByPath.has(path))),
    itemsByKey,
    panes: restoredPanes,
    recentFiles: session.recentFilePaths.flatMap((path) => {
      const file = filesByPath.get(path);
      return file ? [file] : [];
    }),
    tabsById: assignedTabsById,
    taskBoard: session.taskBoard,
  };
};

type RestoredTextFileReader = typeof readTextFile;

export const loadRestoredTextFileBuffers = async (
  tabsById: Readonly<Record<string, WorkspaceTabState>>,
  itemsByKey: Readonly<Record<string, WorkspaceItem>>,
  readFile: RestoredTextFileReader = readTextFile,
  onReadFailure?: (path: string, message: string) => void,
) => {
  const paths = [
    ...new Set(
      Object.values(tabsById).flatMap((tab) => {
        const item = itemsByKey[tab.currentResourceKey];
        if (
          !isFileWorkspaceItem(item) ||
          isLargeTextFile(item.file) ||
          !isEditableFile(item.file.mimeType, item.file.path)
        ) {
          return [];
        }
        return [item.file.path];
      }),
    ),
  ];

  const loaded = await Promise.all(
    paths.map(async (path) => ({
      path,
      result: await readFile(path).catch((error: unknown) => ({
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      })),
    })),
  );

  return loaded.flatMap(({ path, result }) => {
    if (result.success) return [{ path, content: result.content, version: result.version }];
    onReadFailure?.(path, result.error);
    return [];
  });
};

export const useWorkspaceSession = () => {
  const store = useStore();
  const workspacePath = getWorkspacePath();
  const transition = useAtomValue(workspaceTransitionAtom);
  const panes = useAtomValue(workspacePanesAtom);
  const activePaneId = useAtomValue(activePaneIdAtom);
  const tabsById = useAtomValue(workspaceTabsByIdAtom);
  const expandedDirectories = useAtomValue(expandedDirectoriesAtom);
  const fileAccesses = useAtomValue(fileAccessesAtom);
  const recentFiles = useAtomValue(recentFilesAtom);
  const explorerSections = useAtomValue(explorerSectionsAtom);
  const explorerSectionSizes = useAtomValue(explorerSectionSizesAtom);
  const taskBoard = useAtomValue(taskBoardPreferencesAtom);
  const [restoreState, setRestoreState] = useState<{ path: string; phase: "idle" | "loading" | "finished" | "error" }>({
    path: workspacePath,
    phase: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const initialTabs = store.get(workspaceTabsByIdAtom);
    const initialPanes = store.get(workspacePanesAtom);
    const initialNavigation = store.get(workspaceNavigationRevisionAtom);
    const workspaceGeneration = getWorkspaceTransitionGeneration();
    const isCurrent = () => !cancelled && getWorkspacePath() === workspacePath;
    const canRestore = () =>
      isCurrent() &&
      !isWorkspaceTransitionActive() &&
      getWorkspaceTransitionGeneration() === workspaceGeneration &&
      Object.keys(initialTabs).length === 0 &&
      store.get(workspaceTabsByIdAtom) === initialTabs &&
      store.get(workspacePanesAtom) === initialPanes &&
      store.get(workspaceNavigationRevisionAtom) === initialNavigation;
    setRestoreState({ path: workspacePath, phase: "idle" });

    const start = () => {
      if (started || store.get(fileTreeLoadStateAtom) !== "ready") return;
      started = true;
      setRestoreState({ path: workspacePath, phase: "loading" });
      void window.config
        .readWorkspaceSession()
        .then(async (session) => {
          if (session && canRestore()) {
            // Watcher refreshes update the tree data without owning this request's lifetime.
            const restoredState = restoreWorkspaceSession(session, store.get(fileTreeAtom), workspacePath);
            const failedLoads: Record<string, FileLoadState> = {};
            const restoredBuffers = await loadRestoredTextFileBuffers(
              restoredState.tabsById,
              restoredState.itemsByKey,
              readTextFile,
              (path, message) => {
                failedLoads[path] = { phase: "error", message };
              },
            );
            if (canRestore()) {
              store.set(fileLoadStatesByPathAtom, (states) => ({ ...states, ...failedLoads }));
              restoredBuffers.forEach((buffer) =>
                store.set(hydrateFileBufferAtom, buffer.path, buffer.content, buffer.version),
              );
              store.set(openWorkspaceItemsByKeyAtom, restoredState.itemsByKey);
              store.set(workspaceTabsByIdAtom, restoredState.tabsById);
              store.set(workspacePanesAtom, restoredState.panes);
              store.set(activePaneIdAtom, restoredState.activePaneId);
              store.set(expandedDirectoriesAtom, restoredState.expandedDirectories);
              store.set(fileAccessesAtom, restoredState.fileAccesses);
              store.set(recentFilesAtom, restoredState.recentFiles);
              store.set(explorerSectionsAtom, restoredState.explorerSections);
              store.set(explorerSectionSizesAtom, restoredState.explorerSectionSizes);
              store.set(taskBoardPreferencesAtom, restoredState.taskBoard);
            }
          }
          if (isCurrent()) setRestoreState({ path: workspacePath, phase: "finished" });
        })
        .catch((error) => {
          console.error("Could not restore workspace session:", error);
          if (isCurrent()) setRestoreState({ path: workspacePath, phase: "error" });
        });
    };
    const unsubscribe = store.sub(fileTreeLoadStateAtom, start);
    start();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store, workspacePath]);

  const snapshot = useMemo<WorkspaceSession>(
    () => ({
      activePaneId,
      expandedDirectories: [...expandedDirectories],
      explorerSectionSizes,
      explorerSections,
      fileAccesses: Object.fromEntries(
        Object.entries(fileAccesses)
          .sort(([, left], [, right]) => right - left)
          .slice(0, MAX_WORKSPACE_SESSION_FILE_ACCESSES),
      ),
      panes,
      recentFilePaths: recentFiles.slice(0, MAX_WORKSPACE_SESSION_RECENT_FILES).map((file) => file.path),
      tabs: Object.values(tabsById),
      taskBoard,
      version: WORKSPACE_SESSION_VERSION,
    }),
    [
      activePaneId,
      expandedDirectories,
      explorerSectionSizes,
      explorerSections,
      fileAccesses,
      panes,
      recentFiles,
      tabsById,
      taskBoard,
    ],
  );

  useEffect(() => {
    if (restoreState.path !== workspacePath || !["finished", "error"].includes(restoreState.phase) || transition)
      return;
    const generation = getWorkspaceTransitionGeneration();
    const timer = window.setTimeout(() => {
      if (
        getWorkspacePath() !== workspacePath ||
        isWorkspaceTransitionActive() ||
        getWorkspaceTransitionGeneration() !== generation
      )
        return;
      void runWorkspaceMutation(() => window.config.saveWorkspaceSession(snapshot)).catch((error) =>
        console.error("Could not save workspace session:", error),
      );
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [restoreState, snapshot, transition, workspacePath]);
};
