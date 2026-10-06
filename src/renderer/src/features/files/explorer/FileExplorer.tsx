import { IconChevron } from "@pierre/icons";
import type { GitStatusEntry } from "@pierre/trees";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  Panel,
  Separator as ResizeSeparator,
  type Layout,
  type LayoutChangedMeta,
  useGroupRef,
} from "react-resizable-panels";

import { useExternalFileImport, useFileCreate, useFileOpen } from "../fileActions";
import { useBookmarkMenu } from "../menus/useBookmarkMenu";
import { useFileMenu } from "../menus/useFileMenu";
import { loadBookmarks } from "../bookmarkPersistence";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import {
  expandedDirectoriesAtom,
  DEFAULT_EXPLORER_SECTION_SIZES,
  explorerSectionSizesAtom,
  explorerSectionsAtom,
  fileTreeAtom,
  fileTreeLoadStateAtom,
  recentFilesAtom,
  reloadRevisionAtom,
} from "@renderer/store/fileExplorerStore";
import { currentFilePathAtom } from "@renderer/store/workspaceResourceStore";
import { getWorkspacePath } from "@renderer/config";
import { RecoveryState } from "@renderer/shared/ui/RecoveryState";
import { Button } from "@renderer/shared/ui/button";
import type { FileItem } from "@shared/file-item";
import type { GitFileStatusSnapshot } from "@shared/git";
import { basename } from "@shared/pathUtils";
import { RESET_LAYOUT_EVENT } from "@renderer/app/layoutPreferences";

import { FileExplorerTree, type FileExplorerTreeHandle } from "./FileExplorerTree";
import { FileExplorerActions, FileExplorerHeader } from "./FileExplorerTreeHeader";
import { buildTreeLookup, normalizeTreePath, toRelativeDirectoryPath } from "./fileExplorerTreeUtils";

type ExplorerSectionKey = "files" | "bookmarks" | "recent";
const EMPTY_GIT_CHANGES = [] as const;
const EXPLORER_SECTION_KEYS: readonly ExplorerSectionKey[] = ["files", "bookmarks", "recent"];
const sectionPanelId = (section: ExplorerSectionKey) => `file-explorer-${section}`;
const sameSectionSizes = (
  left: Record<ExplorerSectionKey, number>,
  right: Record<ExplorerSectionKey, number>,
): boolean => EXPLORER_SECTION_KEYS.every((section) => Math.abs(left[section] - right[section]) < 0.001);

const sameFileTree = (left: FileItem[], right: FileItem[]): boolean =>
  left.length === right.length &&
  left.every((file, index) => {
    const other = right[index];
    return (
      Boolean(other) &&
      file.id === other.id &&
      file.filename === other.filename &&
      file.relativePath === other.relativePath &&
      file.path === other.path &&
      file.isDirectory === other.isDirectory &&
      file.mimeType === other.mimeType &&
      file.sizeBytes === other.sizeBytes &&
      file.version?.id === other.version?.id &&
      file.version?.mtimeMs === other.version?.mtimeMs &&
      file.version?.sizeBytes === other.version?.sizeBytes &&
      sameFileTree(file.children ?? [], other.children ?? [])
    );
  });

const FileShortcutSection = ({
  emptyAction,
  emptyActionLabel,
  emptyDescription,
  items,
  onContextMenu,
  title,
}: {
  emptyAction: () => void;
  emptyActionLabel: string;
  emptyDescription: string;
  items: FileItem[];
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>, file: FileItem) => void;
  title: string;
}) => {
  const currentFilePath = useAtomValue(currentFilePathAtom);
  const { open } = useFileOpen();

  return (
    <div className="file-explorer-shortcut-section">
      <div className="file-explorer-shortcuts">
        {items.length ? (
          items.map((file) => (
            <button
              key={file.path}
              type="button"
              className="file-explorer-shortcut"
              title={file.relativePath}
              aria-current={currentFilePath === file.path ? "page" : undefined}
              onClick={() => void open(file, { focusEditor: true })}
              onAuxClick={(event) => {
                if (event.button === 1) void open(file, { openInNewTab: true });
              }}
              onContextMenu={(event) => onContextMenu(event, file)}
            >
              {getFileGlyph(file.relativePath)}
              <span className="min-w-0 truncate">{basename(file.relativePath)}</span>
            </button>
          ))
        ) : (
          <div className="file-explorer-empty">
            <strong>No {title.toLowerCase()} yet</strong>
            <span>{emptyDescription}</span>
            <Button type="button" variant="outline" size="xs" onClick={emptyAction}>
              {emptyActionLabel}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const ExplorerSection = ({
  actions,
  children,
  className,
  count,
  expanded,
  onToggle,
  title,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  title: string;
}) => {
  const contentId = useId();

  return (
    <section className={`file-explorer-section ${className ?? ""}`} data-expanded={expanded}>
      <div className="file-explorer-section-header">
      <button
        type="button"
        className="file-explorer-section-heading"
        aria-controls={contentId}
        aria-expanded={expanded}
        aria-label={`${title} section`}
        onClick={onToggle}
      >
        <IconChevron className="file-explorer-section-chevron" size={12} aria-hidden="true" />
        <span>{title}</span>
        <span className="file-explorer-section-count">{count}</span>
      </button>
      {actions}
      </div>
      <div
        id={contentId}
        className="file-explorer-section-content"
        role="region"
        aria-label={title}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        {children}
      </div>
    </section>
  );
};

export const FileExplorer = memo(({ onSearch }: { onSearch: () => void }) => {
  const directoryPath = getWorkspacePath();
  const [fileTree, setFileTree] = useAtom(fileTreeAtom);
  const [expandedDirectories, setExpandedDirectories] = useAtom(expandedDirectoriesAtom);
  const [reloadRevision, setReloadRevision] = useAtom(reloadRevisionAtom);
  const { importExternalFiles } = useExternalFileImport();
  const { openBookmarkMenu } = useBookmarkMenu();
  const { openFileMenu } = useFileMenu();
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);
  const [recentFiles, setRecentFiles] = useAtom(recentFilesAtom);
  const [loadError, setLoadError] = useState(false);
  const [fileTreeLoadState, setFileTreeLoadState] = useAtom(fileTreeLoadStateAtom);
  const { createNewFile } = useFileCreate();
  const [gitStatus, setGitStatus] = useState<GitFileStatusSnapshot>({ status: "not-repository", changes: [] });
  const [gitRefreshRevision, setGitRefreshRevision] = useState(0);
  const [expandedSections, setExpandedSections] = useAtom(explorerSectionsAtom);
  const [sectionSizes, setSectionSizes] = useAtom(explorerSectionSizesAtom);
  const sectionGroupRef = useGroupRef();
  const locallyAppliedSectionSizesRef = useRef(sectionSizes);
  const treeRef = useRef<FileExplorerTreeHandle | null>(null);
  const treeRevisionRef = useRef(-1);
  const treeLookup = useMemo(() => buildTreeLookup(fileTree), [fileTree]);
  const treePathsRef = useRef<Set<string>>(new Set());
  treePathsRef.current = new Set(treeLookup.paths.map((treePath) => normalizeTreePath(treePath).replace(/\/+$/u, "")));
  const directoryPaths = treeLookup.directoryTreePaths.map(toRelativeDirectoryPath);
  const fileCount = treeLookup.paths.length - treeLookup.directoryTreePaths.length;
  const allDirectoriesExpanded =
    directoryPaths.length > 0 && directoryPaths.every((path) => expandedDirectories.has(path));
  const gitChanges = gitStatus.status === "ready" ? gitStatus.changes : EMPTY_GIT_CHANGES;
  const pierreGitStatus = useMemo<GitStatusEntry[]>(
    () => gitChanges.map((change) => ({ path: change.path, status: change.kind })),
    [gitChanges],
  );
  const toggleAllDirectories = useCallback(() => treeRef.current?.toggleAllDirectories(), []);
  const toggleSection = useCallback((section: ExplorerSectionKey) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }, []);
  const expandedSectionKeys = EXPLORER_SECTION_KEYS.filter((section) => expandedSections[section]);
  const layoutKey = expandedSectionKeys.join(":");
  const appliedSectionLayoutKeyRef = useRef(layoutKey);
  const defaultSectionLayout = useMemo<Layout>(
    () => ({
      [sectionPanelId("files")]: sectionSizes.files,
      [sectionPanelId("bookmarks")]: sectionSizes.bookmarks,
      [sectionPanelId("recent")]: sectionSizes.recent,
    }),
    [sectionSizes.bookmarks, sectionSizes.files, sectionSizes.recent],
  );
  const saveSectionLayout = (layout: Layout, meta: LayoutChangedMeta) => {
    if (!meta.isUserInteraction) return;

    setSectionSizes((current) => {
      const visibleLayoutTotal = expandedSectionKeys.reduce(
        (total, section) => total + (layout[sectionPanelId(section)] ?? 0),
        0,
      );
      const visibleStoredTotal = expandedSectionKeys.reduce((total, section) => total + current[section], 0);
      if (visibleLayoutTotal <= 0 || visibleStoredTotal <= 0) return current;

      const next = { ...current };
      for (const section of expandedSectionKeys) {
        const size = layout[sectionPanelId(section)];
        if (typeof size === "number" && Number.isFinite(size) && size > 0) {
          next[section] = (size / visibleLayoutTotal) * visibleStoredTotal;
        }
      }
      const resolved = sameSectionSizes(next, current) ? current : next;
      locallyAppliedSectionSizesRef.current = resolved;
      return resolved;
    });
  };

  useEffect(() => {
    const resetSectionSizes = () => setSectionSizes(DEFAULT_EXPLORER_SECTION_SIZES);
    window.addEventListener(RESET_LAYOUT_EVENT, resetSectionSizes);
    return () => window.removeEventListener(RESET_LAYOUT_EVENT, resetSectionSizes);
  }, [setSectionSizes]);

  useLayoutEffect(() => {
    const sectionVisibilityChanged = appliedSectionLayoutKeyRef.current !== layoutKey;
    const sectionSizesChanged = !sameSectionSizes(sectionSizes, locallyAppliedSectionSizesRef.current);
    if (!sectionVisibilityChanged && !sectionSizesChanged) return;

    // Panel constraint changes register during this commit. Restore after the
    // group has processed them, otherwise an expanding panel is still capped
    // at its collapsed height and the remembered size is redistributed.
    const frame = window.requestAnimationFrame(() => {
      appliedSectionLayoutKeyRef.current = layoutKey;
      locallyAppliedSectionSizesRef.current = sectionSizes;
      sectionGroupRef.current?.setLayout(defaultSectionLayout);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [defaultSectionLayout, layoutKey, sectionGroupRef, sectionSizes]);

  useEffect(() => {
    let ignore = false;

    const loadFiles = async () => {
      setFileTreeLoadState("loading");
      try {
        const result = await window["api"].getFilesRecursiveAsTree(directoryPath);
        if (ignore || result.revision < treeRevisionRef.current) return;

        treeRevisionRef.current = result.revision;
        setFileTree((prev) => (sameFileTree(prev, result.items) ? prev : result.items));
        const availablePaths = buildTreeLookup(result.items).byAbsolutePath;
        setRecentFiles((files) => files.filter((file) => availablePaths.has(file.path)));
        const hydratedBookmarks = await loadBookmarks(result.items);
        setBookmarks(hydratedBookmarks);
        setLoadError(false);
        setFileTreeLoadState("ready");
      } catch (error) {
        if (!ignore) {
          console.error("Unable to load file explorer:", error);
          setLoadError(true);
          setFileTreeLoadState("error");
        }
      }
    };

    loadFiles();
    return () => {
      ignore = true;
    };
  }, [directoryPath, reloadRevision, setBookmarks, setFileTree, setFileTreeLoadState, setRecentFiles]);

  useEffect(() => {
    let ignore = false;
    const loadGitStatus = async () => {
      try {
        const result = await window.api.getGitFileStatus();
        if (!ignore) setGitStatus(result);
      } catch (error) {
        console.error("Unable to load Git file status:", error);
        if (!ignore) setGitStatus({ status: "unavailable", changes: [], error: "Git status is unavailable." });
      }
    };

    void loadGitStatus();
    return () => {
      ignore = true;
    };
  }, [directoryPath, gitRefreshRevision, reloadRevision]);

  useEffect(() => {
    const refreshAll = () => setReloadRevision((revision) => revision + 1);
    const refreshGit = () => setGitRefreshRevision((revision) => revision + 1);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshGit();
    };
    const unsubscribe = window.api.onGitFileStatusChanged((event) => {
      if (!event.treeMayHaveChanged) {
        refreshGit();
        return;
      }

      const changedPaths = [...new Set(event.paths ?? [])].filter(Boolean);
      if (changedPaths.length === 0) {
        refreshAll();
        return;
      }

      void Promise.all(
        changedPaths.map(async (relativePath) => {
          const normalizedPath = normalizeTreePath(relativePath).replace(/\/+$/u, "");
          const wasInTree = treePathsRef.current.has(normalizedPath);
          const existsNow = await window.api.doesFileExist(relativePath);
          return wasInTree !== existsNow;
        }),
      )
        .then((shapeChanges) => {
          if (shapeChanges.some(Boolean)) refreshAll();
          else refreshGit();
        })
        .catch(() => refreshAll());
    });

    window.addEventListener("focus", refreshGit);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshGit);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [setReloadRevision]);

  const handleExternalFileDrop = useCallback(
    (files: File[], destinationDirectory: FileItem | null) => {
      void importExternalFiles(files, destinationDirectory?.path ?? directoryPath);
    },
    [directoryPath, importExternalFiles],
  );

  return (
    <div className="file-explorer h-full flex flex-col flex-1 min-h-0">
      <FileExplorerHeader
        onSearch={onSearch}
        workspaceName={basename(directoryPath)}
        workspacePath={directoryPath}
      />
      {loadError ? (
        <RecoveryState
          compact
          title="Files couldn't be refreshed"
          description="The last available file list is still shown below. Check that the workspace folder is connected and accessible."
          onAction={() => setReloadRevision((revision) => revision + 1)}
        />
      ) : null}
      <Group
        id="file-explorer-sections"
        orientation="vertical"
        defaultLayout={defaultSectionLayout}
        groupRef={sectionGroupRef}
        onLayoutChanged={saveSectionLayout}
        resizeTargetMinimumSize={{ coarse: 20, fine: 8 }}
        className="file-explorer-sections"
      >
        <Panel
          id={sectionPanelId("files")}
          className="file-explorer-section-panel"
          disabled={!expandedSections.files}
          minSize={expandedSections.files ? "96px" : "27px"}
          maxSize={expandedSections.files ? undefined : "27px"}
        >
          <ExplorerSection
            className="file-explorer-section-files"
            title="Files"
            actions={<FileExplorerActions allDirectoriesExpanded={allDirectoriesExpanded} onToggleAllDirectories={toggleAllDirectories} />}
            count={fileCount}
            expanded={expandedSections.files}
            onToggle={() => toggleSection("files")}
          >
            {fileTreeLoadState === "ready" && fileTree.length === 0 ? (
              <div
                className="file-explorer-empty file-explorer-empty-workspace"
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                }}
                onDrop={(event) => {
                  const files = Array.from(event.dataTransfer.files);
                  if (!files.length) return;
                  event.preventDefault();
                  handleExternalFileDrop(files, null);
                }}
              >
                <strong>This workspace is empty</strong>
                <span>Create the first note, or drag files here to import them.</span>
                <Button type="button" size="xs" onClick={() => void createNewFile()}>
                  Create a note
                </Button>
              </div>
            ) : (
              <FileExplorerTree
                ref={treeRef}
                enableFileMove
                expandedDirectories={expandedDirectories}
                gitStatus={pierreGitStatus}
                items={fileTree}
                onExternalFileDrop={handleExternalFileDrop}
                onExpandedDirectoriesChange={setExpandedDirectories}
                syncSelection
              />
            )}
          </ExplorerSection>
        </Panel>
        <ResizeSeparator
          className="file-explorer-section-resizer"
          disabled={!(expandedSections.files && expandedSections.bookmarks)}
          aria-label="Resize Files and Bookmarks sections"
        />
        <Panel
          id={sectionPanelId("bookmarks")}
          className="file-explorer-section-panel"
          disabled={!expandedSections.bookmarks}
          minSize={expandedSections.bookmarks ? "72px" : "27px"}
          maxSize={expandedSections.bookmarks ? undefined : "27px"}
        >
          <ExplorerSection
            className="file-explorer-section-shortcuts"
            title="Bookmarks"
            count={bookmarks.length}
            expanded={expandedSections.bookmarks}
            onToggle={() => toggleSection("bookmarks")}
          >
            <FileShortcutSection
              title="Bookmarks"
              items={bookmarks}
              onContextMenu={openBookmarkMenu}
              emptyAction={() => setExpandedSections((current) => ({ ...current, files: true }))}
              emptyActionLabel="Browse files"
              emptyDescription="Bookmark a note from its context menu to keep it close."
            />
          </ExplorerSection>
        </Panel>
        <ResizeSeparator
          className="file-explorer-section-resizer"
          disabled={!(expandedSections.recent && (expandedSections.files || expandedSections.bookmarks))}
          aria-label="Resize upper and Recent sections"
        />
        <Panel
          id={sectionPanelId("recent")}
          className="file-explorer-section-panel"
          disabled={!expandedSections.recent}
          minSize={expandedSections.recent ? "72px" : "27px"}
          maxSize={expandedSections.recent ? undefined : "27px"}
        >
          <ExplorerSection
            className="file-explorer-section-shortcuts"
            title="Recent"
            count={recentFiles.length}
            expanded={expandedSections.recent}
            onToggle={() => toggleSection("recent")}
          >
            <FileShortcutSection
              title="Recent"
              items={recentFiles}
              onContextMenu={openFileMenu}
              emptyAction={onSearch}
              emptyActionLabel="Search files"
              emptyDescription="Notes you open will appear here for quick access."
            />
          </ExplorerSection>
        </Panel>
      </Group>
    </div>
  );
});
