import { noteFileTypesAtom } from "@renderer/store/noteFileTypeStore";
import { noteFileTreeIconCss } from "@renderer/shared/icons/noteFileTreeIcons";
import type { FileTree as FileTreeModel, FileTreeDropResult, FileTreeRenameEvent, GitStatusEntry } from "@pierre/trees";
import { useFileTree } from "@pierre/trees/react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useFileRename } from "../fileActions";
import { FILE_GLYPH_ICONS, FILE_GLYPH_SIZE } from "@renderer/shared/icons/FileGlyphs";
import { currentFilePathAtom } from "@renderer/store/workspaceResourceStore";
import {
  expandedDirectoriesAtom,
  explorerSelectionPathsAtom,
  fileExplorerRevealRequestAtom,
  reloadRevisionAtom,
  renamingRequestAtom,
} from "@renderer/store/fileExplorerStore";
import { getWorkspacePath } from "@renderer/config";
import type { FileItem } from "@shared/file-item";

import {
  OPEN_FILE_HIGHLIGHT_COLOR,
  OPEN_FILE_STYLE_ID,
  TREE_ITEM_HEIGHT,
  TREE_OVERSCAN,
  TREE_UNSAFE_CSS,
} from "./tree/explorerTreeConfig";
import {
  getExplorerTreeRowElement,
  getExplorerTreeRowSelector,
  getExplorerTreeScrollElement,
} from "./tree/explorerTreeDom";
import { shakeElement } from "../shake";
import {
  EMPTY_LOOKUP,
  buildTreeLookup,
  getDirectoryTreePathChain,
  getFileTreeMoveIntent,
  getUniqueTreeMovePath,
  getMarkdownExplorerName,
  getRenamingItemTreePath,
  getRenameEventDestinationName,
  getRenameEventSourceTreePath,
  isTreeDirectoryHandle,
  sameStringArray,
  sameStringSet,
  toDirectoryTreePath,
  toRelativeDirectoryPath,
  type TreeLookup,
} from "./fileExplorerTreeUtils";

const FILE_EXPLORER_TREE_UNSAFE_CSS = `${TREE_UNSAFE_CSS}
  :host {
    --trees-icon-width-override: ${FILE_GLYPH_SIZE}px;
    --trees-item-margin-x-override: 5px;
    --trees-padding-inline-override: 0px;
    --trees-git-lane-width-override: var(--git-status-marker-width);
    --trees-git-added-color-override: var(--git-status-added);
    --trees-git-deleted-color-override: var(--git-status-deleted);
    --trees-git-modified-color-override: var(--git-status-modified);
    --trees-git-renamed-color-override: var(--git-status-renamed);
    --trees-git-untracked-color-override: var(--git-status-untracked);
  }

  [data-icon-name='file-tree-icon-file'] {
    width: ${FILE_GLYPH_SIZE}px;
    height: ${FILE_GLYPH_SIZE}px;
  }

  [data-type='item'] > [data-item-section='icon'] {
    color: var(--muted-foreground) !important;
    opacity: 1 !important;
  }

  [data-item-git-status] > [data-item-section='content'],
  [data-item-git-status] > [data-item-section='decoration'] {
    color: inherit !important;
  }

  [data-item-git-status]
    > [data-item-section='icon']
    > :where(:not([data-icon-name='file-tree-icon-chevron'])) {
    color: inherit !important;
  }

  [data-item-git-status] > [data-item-section='git'] {
    font-family: var(--font-mono);
    font-size: var(--git-status-marker-font-size) !important;
    font-weight: var(--git-status-marker-font-weight) !important;
    line-height: 1;
  }

  [data-item-type='folder'][data-item-contains-git-change='true'] > [data-item-section='git'] {
    visibility: hidden;
  }

  [data-item-section='content']:has([data-item-rename-input]) {
    flex: 1 1 0;
  }

  [data-item-rename-input] {
    padding-inline: 0 !important;
    box-shadow: inset 0 -2px 0 var(--border-selected) !important;
    caret-color: var(--editor-caret);
  }

  [data-item-rename-input]::selection {
    color: var(--text-primary);
    background-color: var(--surface-selected);
  }

  [data-type='item']:is(
      [data-obim-markdown-file='true'],
      [data-item-path$='.md' i],
      [data-item-path$='.markdown' i]
    ) > [data-item-section='content']:not(:has([data-item-rename-input])) {
    display: none;
  }

  [data-type='item']:is(
      [data-obim-markdown-file='true'],
      [data-item-path$='.md' i],
      [data-item-path$='.markdown' i]
    ) > [data-item-section='decoration'],
  [data-type='item']:is(
      [data-obim-markdown-file='true'],
      [data-item-path$='.md' i],
      [data-item-path$='.markdown' i]
    ) > [data-item-section='decoration'] > span {
    justify-content: flex-start;
    color: inherit;
  }

  [data-type='item'].obim-external-drop-target {
    background-color: var(--surface-selected) !important;
    box-shadow: none !important;
    --truncate-marker-background-overlay-color: var(--surface-selected) !important;
  }

  :host(.obim-external-drop-root) [data-file-tree-virtualized-wrapper='true'],
  :host(.obim-external-drop-root) [data-file-tree-virtualized-root='true'],
  :host(.obim-external-drop-root) [data-file-tree-virtualized-scroll='true'] {
    background-color: var(--surface-selected) !important;
    box-shadow: inset 0 0 0 2px var(--border-selected);
  }

`;

interface UseFileExplorerModelOptions {
  enableFileMove: boolean;
  expandedDirectories?: Set<string>;
  gitStatus?: readonly GitStatusEntry[];
  items: FileItem[];
  onExpandedDirectoriesChange?: (directories: Set<string>) => void;
  syncSelection: boolean;
}

type TreeScrollSnapshot = {
  atBottom: boolean;
  left: number;
  maxTop: number;
  top: number;
};

const getTreeScrollSnapshot = (model: FileTreeModel): TreeScrollSnapshot | null => {
  const element = getExplorerTreeScrollElement(model);
  if (!element) return null;

  const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return {
    atBottom: maxTop - element.scrollTop <= TREE_ITEM_HEIGHT,
    left: element.scrollLeft,
    maxTop,
    top: element.scrollTop,
  };
};

const restoreTreeScroll = (model: FileTreeModel, snapshot: TreeScrollSnapshot) => {
  const element = getExplorerTreeScrollElement(model);
  if (!element) return;

  element.scrollTop = snapshot.atBottom ? Math.max(0, element.scrollHeight - element.clientHeight) : snapshot.top;
  element.scrollLeft = snapshot.left;
};

const shouldRestoreScroll = (snapshot: TreeScrollSnapshot) =>
  snapshot.top > 0 || snapshot.left > 0 || snapshot.maxTop > TREE_ITEM_HEIGHT;

export const useFileExplorerModel = ({
  enableFileMove,
  expandedDirectories,
  gitStatus,
  items,
  onExpandedDirectoriesChange,
  syncSelection,
}: UseFileExplorerModelOptions) => {
  const setSelectedPaths = useSetAtom(explorerSelectionPathsAtom);
  const setExpandedDirectories = useSetAtom(expandedDirectoriesAtom);
  const currentFilePath = useAtomValue(currentFilePathAtom);
  const revealRequest = useAtomValue(fileExplorerRevealRequestAtom);
  const renamingRequest = useAtomValue(renamingRequestAtom);
  const store = useStore();
  const { saveRename, stopRenaming } = useFileRename();
  const rootDirectoryPath = getWorkspacePath();

  const lookup = useMemo(() => (items.length > 0 ? buildTreeLookup(items) : EMPTY_LOOKUP), [items]);
  const noteTypes = useAtomValue(noteFileTypesAtom);
  const noteIconCss = useMemo(() => noteFileTreeIconCss(
    [...lookup.byTreePath].flatMap(([treePath, file]) => {
      const type = noteTypes[file.path];
      return type ? [[treePath, type] as const] : [];
    }),
  ), [lookup, noteTypes]);
  const lookupRef = useRef<TreeLookup>(lookup);
  const lastSyncedTreePathsRef = useRef<readonly string[]>([]);
  const expandedTreePathsRef = useRef<string[]>([]);
  const expandedDirectoriesRef = useRef(expandedDirectories ?? new Set<string>());
  const expansionWorkspaceRef = useRef(rootDirectoryPath);
  const staleExpansionRef = useRef<Set<string> | undefined>(undefined);
  const resetWorkspaceRef = useRef(false);
  const syncingExpansionRef = useRef(false);
  const currentExpandedDirectories =
    expansionWorkspaceRef.current === rootDirectoryPath && expandedDirectories !== staleExpansionRef.current
      ? expandedDirectories
      : undefined;
  const onDropCompleteRef = useRef<(event: FileTreeDropResult) => void>(() => {});
  const handleRenameRef = useRef<(event: FileTreeRenameEvent) => void>(() => {});
  const shakeRenameTargetRef = useRef<() => void>(() => {});
  const handleSelectionChangeRef = useRef<(paths: readonly string[]) => void>(() => {});

  useEffect(() => {
    lookupRef.current = lookup;
    if (expansionWorkspaceRef.current !== rootDirectoryPath) {
      expansionWorkspaceRef.current = rootDirectoryPath;
      staleExpansionRef.current = expandedDirectories;
      expandedDirectoriesRef.current = new Set();
      expandedTreePathsRef.current = [];
      lastSyncedTreePathsRef.current = [];
      resetWorkspaceRef.current = true;
    }
    if (currentExpandedDirectories) expandedDirectoriesRef.current = currentExpandedDirectories;
  }, [currentExpandedDirectories, expandedDirectories, lookup, rootDirectoryPath]);

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: false,
    gitStatus,
    icons: FILE_GLYPH_ICONS,
    initialExpansion: "closed",
    itemHeight: TREE_ITEM_HEIGHT,
    overscan: TREE_OVERSCAN,
    unsafeCSS: FILE_EXPLORER_TREE_UNSAFE_CSS,
    dragAndDrop: enableFileMove
      ? {
          canDrag: (paths) => paths.some((path) => lookupRef.current.byTreePath.has(path)),
          canDrop: ({ draggedPaths, target }) =>
            getFileTreeMoveIntent(draggedPaths, target, lookupRef.current, rootDirectoryPath) !== null,
          onDropComplete: (event) => onDropCompleteRef.current(event),
          onDropError: (error, event) => {
            const intent = getFileTreeMoveIntent(
              event.draggedPaths,
              event.target,
              lookupRef.current,
              rootDirectoryPath,
            );
            if (!intent) {
              console.error("Unable to move file:", error);
              return;
            }

            // Filesystem moves number collisions, so mirror that policy if Pierre rejects its optimistic move.
            const occupiedPaths = new Set(lookupRef.current.paths);
            try {
              model.batch(
                intent.sourceTreePaths.map((path) => {
                  const to = getUniqueTreeMovePath(path, intent.treePath, occupiedPaths);
                  occupiedPaths.add(to);
                  return { from: path, to, type: "move" as const };
                }),
              );
            } catch {
              // The filesystem move below still runs; the refreshed tree will supply the final state.
            }
            onDropCompleteRef.current({
              ...event,
              operation: event.draggedPaths.length > 1 ? "batch" : "move",
            });
          },
          openOnDropDelay: 500,
        }
      : false,
    onSelectionChange: (paths) => handleSelectionChangeRef.current(paths),
    renderRowDecoration: ({ item }) => {
      const file = lookupRef.current.byTreePath.get(item.path);
      const displayName = file ? getMarkdownExplorerName(file) : null;
      return displayName === null ? null : { text: displayName };
    },
    renaming: {
      canRename: (item) => lookupRef.current.byTreePath.has(getRenamingItemTreePath(item)),
      onRename: (event) => handleRenameRef.current(event),
      onError: (error) => {
        console.error("Unable to rename file:", error);
        shakeRenameTargetRef.current();
      },
    },
  });

  useEffect(() => {
    if (!noteIconCss) return;
    const style = document.createElement("style");
    style.dataset.noteFileIcons = "true";
    style.textContent = noteIconCss;
    let frame: number | undefined;
    const attach = () => {
      const root = model.getFileTreeContainer()?.shadowRoot;
      if (root) root.appendChild(style);
      else frame = window.requestAnimationFrame(attach);
    };
    attach();
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      style.remove();
    };
  }, [model, noteIconCss]);

  useEffect(() => model.setGitStatus(gitStatus), [gitStatus, model]);

  const expandedTreePaths = useMemo(() => {
    if (!currentExpandedDirectories) return [];
    return lookup.directoryTreePaths.filter((path) => currentExpandedDirectories.has(toRelativeDirectoryPath(path)));
  }, [currentExpandedDirectories, lookup]);

  useEffect(() => {
    expandedTreePathsRef.current = expandedTreePaths;
  }, [expandedTreePaths]);

  const shakeRenameTarget = useCallback(() => {
    window.requestAnimationFrame(() => {
      const focusedPath = model.getFocusedPath();
      const row = focusedPath ? getExplorerTreeRowElement(model, focusedPath) : null;
      shakeElement(row?.querySelector("[data-item-section='content']") ?? row);
    });
  }, [model]);

  const handleRename = useCallback(
    async (event: FileTreeRenameEvent) => {
      const sourceItem = lookupRef.current.byTreePath.get(getRenameEventSourceTreePath(event));
      if (!sourceItem) {
        shakeRenameTarget();
        store.set(reloadRevisionAtom, (revision) => revision + 1);
        return;
      }

      const result = await saveRename(sourceItem.path, getRenameEventDestinationName(event));
      if (!result.success) {
        shakeRenameTarget();
        store.set(reloadRevisionAtom, (revision) => revision + 1);
      }
    },
    [saveRename, shakeRenameTarget, store],
  );

  const handleSelectionChange = useCallback(
    (paths: readonly string[]) => {
      if (!syncSelection) return;

      const nextSelectedPaths = paths
        .map((path) => lookupRef.current.byTreePath.get(path)?.path)
        .filter((path): path is string => Boolean(path));

      setSelectedPaths((prev) => (sameStringArray(prev, nextSelectedPaths) ? prev : nextSelectedPaths));
    },
    [setSelectedPaths, syncSelection],
  );

  useEffect(() => {
    handleRenameRef.current = handleRename;
    shakeRenameTargetRef.current = shakeRenameTarget;
    handleSelectionChangeRef.current = handleSelectionChange;
  }, [handleRename, handleSelectionChange, shakeRenameTarget]);

  useEffect(() => {
    if (!resetWorkspaceRef.current && sameStringArray(lastSyncedTreePathsRef.current, lookup.paths)) return undefined;

    const scrollPosition = getTreeScrollSnapshot(model);
    const selectedTreePaths = syncSelection
      ? store
          .get(explorerSelectionPathsAtom)
          .map((path) => lookup.byAbsolutePath.get(path))
          .filter((path): path is string => Boolean(path))
      : [];

    const liveExpandedTreePaths = resetWorkspaceRef.current
      ? []
      : lookup.directoryTreePaths.filter((path) => {
          const item = model.getItem(path);
          return isTreeDirectoryHandle(item) && item.isExpanded();
        });
    const initialExpandedPaths = Array.from(new Set([...liveExpandedTreePaths, ...expandedTreePathsRef.current]));

    syncingExpansionRef.current = true;
    try {
      model.resetPaths(lookup.paths, { initialExpandedPaths });
    } finally {
      syncingExpansionRef.current = false;
    }
    resetWorkspaceRef.current = false;
    lastSyncedTreePathsRef.current = lookup.paths;

    if (syncSelection && !sameStringArray(model.getSelectedPaths(), selectedTreePaths)) {
      model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
      selectedTreePaths.forEach((path) => model.getItem(path)?.select());
    }

    const focusedPath = model.getFocusedPath();
    if (syncSelection && selectedTreePaths[0] && !selectedTreePaths.includes(focusedPath ?? "")) {
      model.focusPath(selectedTreePaths[0]);
    }

    if (!scrollPosition || !shouldRestoreScroll(scrollPosition)) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      restoreTreeScroll(model, scrollPosition);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [lookup.byAbsolutePath, lookup.paths, model, rootDirectoryPath, store, syncSelection]);

  // Restoration can arrive after an unchanged tree has already been constructed.
  // Apply the current controlled state directly; subsequent user changes replace that state.
  useEffect(() => {
    if (!currentExpandedDirectories) return;
    syncingExpansionRef.current = true;
    try {
      for (const path of lookup.directoryTreePaths) {
        const item = model.getItem(path);
        if (!isTreeDirectoryHandle(item)) continue;
        const expand = currentExpandedDirectories.has(toRelativeDirectoryPath(path));
        if (expand && !item.isExpanded()) item.expand();
        else if (!expand && item.isExpanded()) item.collapse();
      }
    } finally {
      syncingExpansionRef.current = false;
    }
  }, [currentExpandedDirectories, lookup.directoryTreePaths, model]);

  useEffect(() => {
    const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
    if (!shadowRoot) return undefined;

    let styleElement = shadowRoot.getElementById(OPEN_FILE_STYLE_ID);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = OPEN_FILE_STYLE_ID;
      shadowRoot.append(styleElement);
    }

    const currentTreePath = currentFilePath ? lookup.byAbsolutePath.get(currentFilePath) : null;
    styleElement.textContent = currentTreePath
      ? `
        ${getExplorerTreeRowSelector(currentTreePath)}:not([data-item-selected]) {
          background: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
          background-color: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
          --truncate-marker-background-overlay-color: ${OPEN_FILE_HIGHLIGHT_COLOR} !important;
        }
      `
      : "";

    return undefined;
  }, [currentFilePath, lookup.byAbsolutePath, model]);

  useEffect(() => {
    if (!onExpandedDirectoriesChange) return undefined;

    const unsubscribe = model.subscribe(() => {
      if (syncingExpansionRef.current) return;
      const focusedPath = model.getFocusedPath();
      if (!focusedPath) return;

      const item = model.getItem(focusedPath);
      if (!isTreeDirectoryHandle(item)) return;

      const relativePath = toRelativeDirectoryPath(focusedPath);
      const isPersisted = expandedDirectoriesRef.current.has(relativePath);
      if (item.isExpanded() === isPersisted) return;

      const next = new Set(expandedDirectoriesRef.current);
      if (item.isExpanded()) next.add(relativePath);
      else next.delete(relativePath);
      expandedDirectoriesRef.current = next;
      onExpandedDirectoriesChange(next);
    });

    return unsubscribe;
  }, [model, onExpandedDirectoriesChange]);

  useEffect(() => {
    if (!revealRequest) return;

    const targetPath = toDirectoryTreePath(revealRequest.relativePath);
    if (!lookup.byTreePath.has(targetPath)) return;

    const expandedPaths = getDirectoryTreePathChain(targetPath);
    const nextExpandedDirectories = new Set(expandedDirectoriesRef.current);
    expandedPaths.forEach((path) => nextExpandedDirectories.add(toRelativeDirectoryPath(path)));
    if (!sameStringSet(expandedDirectoriesRef.current, nextExpandedDirectories)) {
      expandedDirectoriesRef.current = nextExpandedDirectories;
      setExpandedDirectories(nextExpandedDirectories);
    }

    for (const treePath of expandedPaths) {
      const item = model.getItem(treePath);
      if (isTreeDirectoryHandle(item) && !item.isExpanded()) item.expand();
    }

    model.scrollToPath(targetPath, { focus: false, offset: "nearest" });
    model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
    model.getItem(targetPath)?.select();

    const selectedFilePath = lookup.byTreePath.get(targetPath)?.path;
    if (selectedFilePath) setSelectedPaths([selectedFilePath]);
    store.set(fileExplorerRevealRequestAtom, null);
  }, [lookup.byTreePath, model, revealRequest, setExpandedDirectories, setSelectedPaths, store]);

  useEffect(() => {
    if (!syncSelection) return;

    const validPaths = new Set(lookup.byAbsolutePath.keys());
    setSelectedPaths((prev) => prev.filter((path) => validPaths.has(path)));
  }, [lookup.byAbsolutePath, setSelectedPaths, syncSelection]);

  useEffect(() => {
    if (renamingRequest?.target !== "explorer") return;

    const treePath = lookup.byAbsolutePath.get(renamingRequest.filePath);
    if (!treePath) return;

    if (model.startRenaming(treePath)) stopRenaming(renamingRequest.filePath);
  }, [lookup.byAbsolutePath, model, renamingRequest, stopRenaming]);

  const toggleAllDirectories = useCallback(() => {
    const directoryTreePaths = lookupRef.current.directoryTreePaths;
    if (directoryTreePaths.length === 0) return;

    const allExpanded = directoryTreePaths.every((path) =>
      expandedDirectoriesRef.current.has(toRelativeDirectoryPath(path)),
    );
    const nextTreePaths = allExpanded ? [] : directoryTreePaths;
    const nextDirectories = new Set(nextTreePaths.map(toRelativeDirectoryPath));
    expandedDirectoriesRef.current = nextDirectories;
    model.resetPaths(lookupRef.current.paths, { initialExpandedPaths: nextTreePaths });
    onExpandedDirectoriesChange?.(nextDirectories);
  }, [model, onExpandedDirectoriesChange]);

  return {
    expandedTreePaths,
    onDropCompleteRef,
    lookup,
    lookupRef,
    model,
    toggleAllDirectories,
  };
};
