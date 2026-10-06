import { IconArrowLeftBar, IconFolder, IconSearch, IconTerminal, IconX } from "@pierre/icons";
import { useKeyboardShortcuts } from "@renderer/shared/keyboardShortcuts";
import { shortcutBindings, shortcutLabel } from "@shared/keyboard-shortcuts";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getWorkspacePath } from "@renderer/config";
import { useDailyNoteOpen } from "@renderer/features/daily-notes/useDailyNoteOpen";
import { saveDirtyFileBuffers } from "@renderer/features/files/dirtyFileBuffers";
import {
  useDirectoryCreate,
  useFileCopy,
  useFileCreate,
  useFileMove,
  useFileRemove,
  useFileRename,
  useManageFileBookmark,
} from "@renderer/features/files/fileActions";
import { useFileOpenInNewPane } from "@renderer/features/files/useFileOpenInNewPane";
import { useNotePdfExport } from "@renderer/features/files/useNotePdfExport";
import { revealInSystemFileManager } from "@renderer/features/files/workspaceFileService";
import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import { reloadGitChangedFiles } from "@renderer/features/git/reloadGitChangedFiles";
import { useFileHistoryOpen } from "@renderer/features/git/useFileHistoryOpen";
import { Notifications } from "@renderer/features/notifications/notifications";
import { SearchHighlightedText, SearchKeyHint } from "@renderer/features/search/SearchUi";
import { useListKeyboardNavigation } from "@renderer/features/search/useListKeyboardNavigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@renderer/shared/ui/dialog";
import { actionRunnerRequestAtom } from "@renderer/store/actionRunnerStore";
import {
  settingsDialogOpenRequestAtom,
  shortcutHelpOpenAtom,
  versionHistoryOpenRequestAtom,
} from "@renderer/store/appSessionStore";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { explorerSelectionPathsAtom, fileTreeAtom, reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { isVisibleAtom } from "@renderer/store/SearchWindowStore";
import { activateWorkspaceResourceAtom } from "@renderer/store/workspaceActionStore";
import { currentFileAtom } from "@renderer/store/workspaceResourceStore";
import type { FileItem } from "@shared/file-item";
import type { GitFileStatusSnapshot, GitRemoteSyncOperationResult } from "@shared/git";
import { isGitChangeRevertible } from "@shared/git";
import { getPathWithoutFilename, getRelativePathFromPath } from "@shared/pathUtils";
import { createTaskBoardWorkspaceItem } from "@shared/workspace";

import {
  ACTION_COMMAND_PURPOSES,
  createActionCommands,
  rankActionCommands,
  type ActionCommand,
} from "./actionCommands";
import { CreateTaskAction } from "./CreateTaskAction";
import { getMoveDestinations, getTargetsForDestination } from "./moveToFolder";
import { ImportArticleAction } from "./ImportArticleAction";

const targetSummary = (targets: readonly FileItem[]) => {
  if (targets.length === 1) return targets[0].filename;
  return `${targets.length} items`;
};

const destinationParent = (directory: FileItem) => {
  if (!directory.relativePath) return "Top level of this workspace";
  return getPathWithoutFilename(directory.relativePath) || "Workspace root";
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ActionRunner = () => {
  const store = useStore();
  const request = useAtomValue(actionRunnerRequestAtom);
  const activeFile = useAtomValue(currentFileAtom);
  const fileTree = useAtomValue(fileTreeAtom);
  const bookmarks = useAtomValue(bookmarksAtom);
  const fileBuffers = useAtomValue(fileBuffersByPathAtom);
  const setRequest = useSetAtom(actionRunnerRequestAtom);
  const notify = useSetAtom(addNotificationAtom);
  const [query, setQuery] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [gitSnapshot, setGitSnapshot] = useState<GitFileStatusSnapshot | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const mouseNavigationRef = useRef(false);
  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();
  const { copyManyToDirectory } = useFileCopy();
  const { remove } = useFileRemove();
  const openFileInNewPane = useFileOpenInNewPane();
  const { openNotePdfExport } = useNotePdfExport();
  const openDailyNote = useDailyNoteOpen();
  const { moveManyToDirectory } = useFileMove();
  const { startRenaming } = useFileRename();
  const { addBookmark, removeBookmark } = useManageFileBookmark();
  const { openFileHistory } = useFileHistoryOpen();
  const { currentlySelected, handleKeyDown, setCurrentlySelected, setMaxIndex } = useListKeyboardNavigation();
  const keyboardShortcuts = useKeyboardShortcuts();
  const shortcutText = (id: Parameters<typeof shortcutBindings>[0]) =>
    shortcutBindings(id, keyboardShortcuts)
      .map((binding) => shortcutLabel(binding, Boolean(window.config?.isMacOS)))
      .join(" · ");
  const primaryKey = window.config.isMacOS ? "⌘" : "Ctrl";
  const isMoveView = request?.view === "move-to-folder";
  const isPickerView = isMoveView;
  const workspacePath = getWorkspacePath();

  const close = useCallback(() => {
    setRequest(null);
    setQuery("");
    setIsRunning(false);
  }, [setRequest]);

  useEffect(() => {
    if (!request) return;
    const api = window.api as Partial<Window["api"]>;
    if (typeof api?.getGitFileStatus !== "function") return;

    let disposed = false;
    setGitSnapshot(null);
    const refreshGitStatus = () => {
      void api.getGitFileStatus?.().then(
        (snapshot) => {
          if (!disposed) setGitSnapshot(snapshot);
        },
        (error: unknown) => {
          if (!disposed) {
            setGitSnapshot({ status: "unavailable", changes: [], error: errorMessage(error) });
          }
        },
      );
    };
    refreshGitStatus();
    const unsubscribe =
      typeof api.onGitFileStatusChanged === "function" ? api.onGitFileStatusChanged(refreshGitStatus) : undefined;
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [request]);

  const activeRelativePath = useMemo(() => {
    if (!activeFile) return null;
    try {
      return getRelativePathFromPath(activeFile.path, workspacePath).replaceAll("\\", "/");
    } catch {
      return null;
    }
  }, [activeFile, workspacePath]);
  const readyGitSnapshot = gitSnapshot?.status === "ready" ? gitSnapshot : null;
  const activeGitChange = useMemo(
    () =>
      activeRelativePath
        ? readyGitSnapshot?.changes.find(
            (change) => change.path === activeRelativePath || change.originalPath === activeRelativePath,
          )
        : undefined,
    [activeRelativePath, readyGitSnapshot],
  );
  const activeBuffer = activeFile ? fileBuffers[activeFile.path] : undefined;
  const activeBufferIsDirty = Boolean(activeBuffer && activeBuffer.editorText !== activeBuffer.savedText);
  const writableGitReady = readyGitSnapshot?.repositoryScope === "workspace";
  const gitOperationBlocked = Boolean(readyGitSnapshot?.mergeInProgress);
  const canStageCurrentFile = Boolean(
    activeFile &&
    !activeFile.isDirectory &&
    activeRelativePath &&
    writableGitReady &&
    !gitOperationBlocked &&
    !activeGitChange?.conflicted &&
    (activeBufferIsDirty || activeGitChange?.workingTreeChanged),
  );
  const discardBlockedByRename = Boolean(activeGitChange?.originalPath && activeBuffer);
  const canDiscardActiveFileChanges = Boolean(
    activeFile &&
    !activeFile.isDirectory &&
    writableGitReady &&
    !gitOperationBlocked &&
    (activeBufferIsDirty || activeGitChange) &&
    (!activeGitChange || isGitChangeRevertible(activeGitChange)) &&
    !discardBlockedByRename,
  );
  const canSyncNow = Boolean(writableGitReady && !gitOperationBlocked);

  const unavailableGitDescription = useMemo(() => {
    if (!gitSnapshot) return "Checking version history…";
    if (gitSnapshot.status === "not-repository") return "Start version history to use this action";
    if (gitSnapshot.status === "unavailable") return gitSnapshot.error;
    if (gitSnapshot.repositoryScope === "ancestor") return "Available only from the repository workspace";
    if (gitSnapshot.mergeInProgress) return "Finish or cancel reconciliation first";
    return null;
  }, [gitSnapshot]);
  const stageCurrentFileDescription = canStageCurrentFile
    ? activeFile!.relativePath
    : (unavailableGitDescription ??
      (activeGitChange?.conflicted
        ? "Resolve this file's conflict first"
        : activeFile
          ? "The active file has no unstaged changes"
          : "Open a file to use this action"));
  const discardActiveFileChangesDescription = canDiscardActiveFileChanges
    ? activeFile!.relativePath
    : (unavailableGitDescription ??
      (discardBlockedByRename
        ? "Close this renamed file before discarding changes"
        : activeGitChange && !isGitChangeRevertible(activeGitChange)
          ? "No committed version is available for this new file"
          : activeFile
            ? "The active file has no changes to discard"
            : "Open a file to use this action"));
  const syncNowDescription = canSyncNow
    ? "Fetch, then safely pull or push committed versions"
    : (unavailableGitDescription ?? "Sync is unavailable");

  const showGitNotification = useCallback(
    (level: NotificationLevel, title: string, message: string, path?: string) => {
      notify({ id: crypto.randomUUID(), level, title, message, path, timestamp: Date.now() });
    },
    [notify],
  );
  const requestVersionHistory = useCallback(() => {
    store.set(versionHistoryOpenRequestAtom, (requestNumber) => requestNumber + 1);
  }, [store]);

  const stageCurrentFile = useCallback(async () => {
    if (!canStageCurrentFile || !activeFile || !activeRelativePath) return;
    close();
    try {
      const saved = await saveDirtyFileBuffers(store, (path) => path === activeFile.path);
      if (!saved.success) {
        showGitNotification(NotificationLevel.ERROR, "Could not stage file", saved.error, activeFile.path);
        return;
      }
      const result = await workspaceMutationApi.stageGitPaths([activeGitChange?.path ?? activeRelativePath]);
      if (result.status === "failed") {
        showGitNotification(NotificationLevel.ERROR, "Could not stage file", result.error, activeFile.path);
        return;
      }
      setGitSnapshot(result.snapshot);
      showGitNotification(
        NotificationLevel.INFO,
        "File staged",
        `${activeFile.filename} is ready for the next commit.`,
        activeFile.path,
      );
    } catch (error) {
      showGitNotification(NotificationLevel.ERROR, "Could not stage file", errorMessage(error), activeFile.path);
    }
  }, [activeFile, activeGitChange?.path, activeRelativePath, canStageCurrentFile, close, showGitNotification, store]);

  const discardActiveFileChanges = useCallback(async () => {
    if (!canDiscardActiveFileChanges || !activeFile) return;
    const restoresCommit = Boolean(activeGitChange);
    const confirmed = window.confirm(
      `Discard all changes to ${activeFile.filename}? This restores the last ${restoresCommit ? "committed" : "saved"} version and cannot be undone.`,
    );
    if (!confirmed) return;

    close();
    const bufferBeforeDiscard = store.get(fileBuffersByPathAtom)[activeFile.path];
    try {
      if (activeGitChange) {
        const result = await workspaceMutationApi.revertGitPaths([activeGitChange.path]);
        if (result.status === "failed") {
          showGitNotification(NotificationLevel.ERROR, "Could not discard changes", result.error, activeFile.path);
          return;
        }
        setGitSnapshot(result.snapshot);
        store.set(reloadRevisionAtom, (revision) => revision + 1);
      }

      if (bufferBeforeDiscard && store.get(fileBuffersByPathAtom)[activeFile.path] === bufferBeforeDiscard) {
        if (activeGitChange) {
          const restored = await window.api.openTextFile(activeFile.path);
          if (store.get(fileBuffersByPathAtom)[activeFile.path] === bufferBeforeDiscard) {
            store.set(fileBuffersByPathAtom, (buffers) => ({
              ...buffers,
              [activeFile.path]: {
                editorText: restored.content,
                savedText: restored.content,
                version: restored.version,
              },
            }));
          }
        } else {
          store.set(fileBuffersByPathAtom, (buffers) => ({
            ...buffers,
            [activeFile.path]: { ...bufferBeforeDiscard, editorText: bufferBeforeDiscard.savedText },
          }));
        }
        store.set(fileSaveStatesByPathAtom, (states) => ({
          ...states,
          [activeFile.path]: { phase: "saved", savedAt: Date.now() },
        }));
      }
      showGitNotification(
        NotificationLevel.INFO,
        "Changes discarded",
        `${activeFile.filename} was restored to its last ${restoresCommit ? "committed" : "saved"} version.`,
        activeFile.path,
      );
    } catch (error) {
      showGitNotification(NotificationLevel.ERROR, "Could not discard changes", errorMessage(error), activeFile.path);
    }
  }, [activeFile, activeGitChange, canDiscardActiveFileChanges, close, showGitNotification, store]);

  const syncNow = useCallback(async () => {
    if (!canSyncNow) return;
    close();
    try {
      const fetched = await workspaceMutationApi.fetchGitRemote();
      if (fetched.status === "failed") {
        showGitNotification(NotificationLevel.ERROR, "Could not sync", fetched.error);
        return;
      }
      setGitSnapshot(fetched.snapshot);
      const { sync } = fetched;

      if (sync.state === "up-to-date") {
        showGitNotification(
          NotificationLevel.INFO,
          "Already in sync",
          "Local and remote version history are up to date.",
        );
        return;
      }
      if (sync.state === "no-local-commits") {
        showGitNotification(
          NotificationLevel.WARNING,
          "Nothing to sync",
          "Create a local commit before syncing this workspace.",
        );
        return;
      }
      if (sync.state === "branch-missing") {
        requestVersionHistory();
        showGitNotification(
          NotificationLevel.WARNING,
          "Remote branch needs attention",
          `Open Version History to review the missing ${sync.branch} branch.`,
        );
        return;
      }
      if (sync.state === "diverged") {
        requestVersionHistory();
        showGitNotification(
          NotificationLevel.WARNING,
          "Review version differences",
          "Local and remote history both changed. Version History is open so you can review them safely.",
        );
        return;
      }

      let result: GitRemoteSyncOperationResult;
      if (sync.state === "behind") {
        const hasDirtyEditor = Object.values(store.get(fileBuffersByPathAtom)).some(
          (buffer) => buffer.editorText !== buffer.savedText,
        );
        if (hasDirtyEditor) {
          showGitNotification(
            NotificationLevel.ERROR,
            "Save or discard editor changes",
            "Open editor changes must be resolved before pulling remote versions.",
          );
          return;
        }
        if (
          !window.confirm(
            "Pull remote commits into this workspace? Obim will proceed only with a clean fast-forward and will not overwrite local changes.",
          )
        ) {
          return;
        }
        const buffersBeforePull = store.get(fileBuffersByPathAtom);
        result = await workspaceMutationApi.pullGitRemote();
        if (result.status === "succeeded" && result.action === "pulled") {
          const skipped = await reloadGitChangedFiles({
            buffersBeforeOperation: buffersBeforePull,
            changes: result.changedPaths ?? [],
            fileTree,
            store,
            workspacePath,
          });
          if (skipped > 0) {
            showGitNotification(
              NotificationLevel.WARNING,
              "Remote versions pulled",
              `${skipped} open ${skipped === 1 ? "file changed" : "files changed"} during sync and should be reviewed.`,
            );
            return;
          }
        }
      } else {
        if (
          sync.state === "unpublished" &&
          !window.confirm(
            `Publish the current ${sync.branch} branch to origin? Only committed versions will be uploaded.`,
          )
        ) {
          return;
        }
        result = await workspaceMutationApi.pushGitRemote();
      }

      if (result.status === "failed") {
        showGitNotification(NotificationLevel.ERROR, "Could not sync", result.error);
        return;
      }
      setGitSnapshot(result.snapshot);
      showGitNotification(
        NotificationLevel.INFO,
        "Sync complete",
        result.action === "pulled"
          ? "Remote committed versions were pulled into this workspace."
          : result.action === "pushed"
            ? "Local committed versions were pushed to origin."
            : "Local and remote version history are up to date.",
      );
    } catch (error) {
      showGitNotification(NotificationLevel.ERROR, "Could not sync", errorMessage(error));
    }
  }, [canSyncNow, close, fileTree, requestVersionHistory, showGitNotification, store, workspacePath]);

  const openVersionHistoryPanel = useCallback(() => {
    close();
    requestVersionHistory();
  }, [close, requestVersionHistory]);

  const commands = useMemo(
    () =>
      createActionCommands({
        activeFile,
        isActiveFileBookmarked: Boolean(activeFile && bookmarks.some((bookmark) => bookmark.path === activeFile.path)),
        primaryKey,
        shortcutLabels: { newNote: shortcutText("new-note"), searchFiles: shortcutText("search-files") },
        createFolder: () => {
          close();
          return createDirectory();
        },
        createTask: () => setRequest({ view: "create-task", returnToCommands: true }),
        createNote: () => {
          close();
          return createNewFile();
        },
        openTodayDailyNote: () => {
          close();
          return openDailyNote(new Date());
        },
        importArticle: () => {
          setRequest({ view: "import-article", returnToCommands: true });
        },
        findFiles: () => {
          close();
          store.set(isVisibleAtom, true);
        },
        duplicateFile: (file) => {
          close();
          return copyManyToDirectory([file], getPathWithoutFilename(file.path));
        },
        moveFileToTrash: (file) => {
          close();
          return remove(file);
        },
        openFileInNewPane: (file) => {
          close();
          return openFileInNewPane(file);
        },
        openSettings: () => {
          close();
          store.set(settingsDialogOpenRequestAtom, (requestNumber) => requestNumber + 1);
        },
        openTaskBoard: () => {
          close();
          const item = createTaskBoardWorkspaceItem();
          store.set(activateWorkspaceResourceAtom, { item, resourceKey: item.key });
        },
        showKeyboardShortcuts: () => {
          close();
          window.setTimeout(() => store.set(shortcutHelpOpenAtom, true), 0);
        },
        exportNotePdf: (file) => {
          close();
          openNotePdfExport(file);
        },
        openFileHistory: (file) => {
          close();
          openFileHistory(file);
        },
        openVersionHistory: openVersionHistoryPanel,
        stageCurrentFile,
        syncNow,
        discardActiveFileChanges,
        canStageCurrentFile,
        canSyncNow,
        canDiscardActiveFileChanges,
        stageCurrentFileDescription,
        syncNowDescription,
        discardActiveFileChangesDescription,
        openMoveToFolder: (file) => {
          setQuery("");
          setRequest({ view: "move-to-folder", targets: [file], returnToCommands: true });
        },
        renameFile: (file) => {
          close();
          startRenaming(file.path, "file-header");
        },
        revealFile: (file) => {
          close();
          return revealInSystemFileManager(file.path);
        },
        toggleBookmark: (file, bookmarked) => {
          close();
          return bookmarked ? removeBookmark(file) : addBookmark(file);
        },
      }),
    [
      activeFile,
      addBookmark,
      bookmarks,
      canDiscardActiveFileChanges,
      canStageCurrentFile,
      canSyncNow,
      close,
      copyManyToDirectory,
      createDirectory,
      createNewFile,
      discardActiveFileChanges,
      discardActiveFileChangesDescription,
      openDailyNote,
      openFileInNewPane,
      openNotePdfExport,
      openFileHistory,
      openVersionHistoryPanel,
      primaryKey,
      keyboardShortcuts,
      removeBookmark,
      remove,
      setRequest,
      stageCurrentFile,
      stageCurrentFileDescription,
      startRenaming,
      store,
      syncNow,
      syncNowDescription,
    ],
  );

  const commandResults = useMemo(() => rankActionCommands(commands, query), [commands, query]);
  const commandGroups = useMemo(
    () =>
      ACTION_COMMAND_PURPOSES.map((purpose) => ({
        purpose,
        commands: commandResults.filter((command) => command.purpose === purpose),
      })).filter(({ commands: groupedCommands }) => groupedCommands.length > 0),
    [commandResults],
  );
  const showCommandGroups = request?.view === "commands" && !query.trim();
  const displayedCommandResults = useMemo(
    () =>
      showCommandGroups ? commandGroups.flatMap(({ commands: groupedCommands }) => groupedCommands) : commandResults,
    [commandGroups, commandResults, showCommandGroups],
  );
  const commandResultIndexes = useMemo(
    () => new Map(displayedCommandResults.map((command, index) => [command.id, index])),
    [displayedCommandResults],
  );
  const destinationResults = useMemo(
    () =>
      request?.view === "move-to-folder"
        ? getMoveDestinations(fileTree, getWorkspacePath(), request.targets, query)
        : [],
    [fileTree, query, request],
  );
  const resultCount = isMoveView ? destinationResults.length : displayedCommandResults.length;

  const goBackOrClose = () => {
    if (request?.view !== "commands" && request?.returnToCommands) {
      setQuery("");
      setRequest({ view: "commands" });
      return;
    }
    close();
  };

  const runCommand = (command: ActionCommand) => {
    if (command.disabled || isRunning) return;
    void command.perform();
  };

  const moveToDestination = async (destination: FileItem) => {
    if (request?.view !== "move-to-folder" || isRunning) return;
    const targets = getTargetsForDestination(request.targets, destination.path);
    if (!targets.length) {
      close();
      return;
    }

    setIsRunning(true);
    try {
      const result = await moveManyToDirectory(targets, destination.path);
      const movedPaths = new Map(result.moved.map(({ file, movedPath }) => [file.path, movedPath]));
      const selectedPaths = store.get(explorerSelectionPathsAtom);
      if (selectedPaths.some((path) => movedPaths.has(path))) {
        store.set(
          explorerSelectionPathsAtom,
          selectedPaths.map((path) => movedPaths.get(path) ?? path),
        );
      }
      if (result.failures.length) {
        notify({
          id: crypto.randomUUID(),
          ...Notifications.FILE_MOVE_FAILED(result.moved.length, result.failures.length, result.failures[0].error),
          timestamp: Date.now(),
        });
      }
      close();
    } catch (error) {
      notify({
        id: crypto.randomUUID(),
        ...Notifications.FILE_MOVE_FAILED(0, targets.length, error instanceof Error ? error.message : String(error)),
        timestamp: Date.now(),
      });
      setIsRunning(false);
    }
  };

  const handleKeyboardNavigation = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const navigationKeys = ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
    if (navigationKeys.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      mouseNavigationRef.current = false;
      handleKeyDown(event.nativeEvent);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (isMoveView) {
        const destination = destinationResults[currentlySelected];
        if (destination) void moveToDestination(destination);
      } else {
        const command = displayedCommandResults[currentlySelected];
        if (command) runCommand(command);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      goBackOrClose();
      return;
    }

    if (event.key === "Backspace" && !query && request?.view !== "commands" && request?.returnToCommands) {
      event.preventDefault();
      goBackOrClose();
    }
  };

  useEffect(() => {
    setMaxIndex(resultCount - 1);
  }, [resultCount, setMaxIndex]);

  useEffect(() => {
    if (!mouseNavigationRef.current) {
      listRefs.current[currentlySelected]?.scrollIntoView?.({ behavior: "instant", block: "nearest" });
    }
  }, [currentlySelected]);

  useEffect(() => {
    if (!request) return;
    setQuery("");
    setIsRunning(false);
    setCurrentlySelected(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [request, setCurrentlySelected]);

  if (!request) return null;
  if (request.view === "create-task") return <CreateTaskAction onClose={close} />;
  if (request.view === "import-article") return <ImportArticleAction onClose={close} />;

  const results = isMoveView ? destinationResults : displayedCommandResults;
  const moveTargets = request.view === "move-to-folder" ? request.targets : [];
  const renderCommand = (command: ActionCommand, index: number) => {
    const Icon = command.icon;
    return (
      <button
        key={command.id}
        id={`action-runner-result-${index}`}
        ref={(element) => {
          listRefs.current[index] = element;
        }}
        type="button"
        className="search-panel-result action-runner-result"
        data-selected={currentlySelected === index ? "true" : undefined}
        data-disabled={command.disabled ? "true" : undefined}
        aria-disabled={command.disabled || undefined}
        aria-selected={currentlySelected === index}
        role="option"
        onClick={() => runCommand(command)}
        onMouseMove={() => {
          mouseNavigationRef.current = true;
          setCurrentlySelected(index);
        }}
      >
        <span className="search-panel-file-icon">
          <Icon aria-hidden="true" />
        </span>
        <span className="search-panel-result-copy">
          <span className="search-panel-result-title">
            <SearchHighlightedText query={query} text={command.label} />
          </span>
          <span className="search-panel-result-path">
            <SearchHighlightedText query={query} text={command.description} />
          </span>
        </span>
        {command.shortcut ? <kbd className="action-runner-shortcut">{command.shortcut}</kbd> : null}
      </button>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="search-panel action-runner translate-y-0" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <DialogTitle>{isMoveView ? "Move to folder" : "Action menu"}</DialogTitle>
        </DialogHeader>

        <div className="search-panel-query-row">
          {isPickerView ? (
            <IconSearch className="search-panel-search-icon" aria-hidden="true" />
          ) : (
            <IconTerminal className="search-panel-search-icon" aria-hidden="true" />
          )}
          <span className="action-runner-context">
            {isPickerView ? (
              <>
                {request.returnToCommands ? (
                  <button
                    type="button"
                    className="action-runner-back"
                    onClick={goBackOrClose}
                    aria-label="Back to actions"
                  >
                    <IconArrowLeftBar aria-hidden="true" />
                  </button>
                ) : null}
                <span>Move</span>
                {isMoveView ? (
                  <strong title={moveTargets.map((target) => target.relativePath).join(", ")}>
                    {targetSummary(moveTargets)}
                  </strong>
                ) : null}
              </>
            ) : (
              <>
                <span>Actions</span>
                {activeFile ? <strong title={activeFile.relativePath}>{activeFile.filename}</strong> : null}
              </>
            )}
          </span>
          <input
            ref={inputRef}
            className="search-panel-input"
            value={query}
            disabled={isRunning}
            onChange={(event) => {
              mouseNavigationRef.current = false;
              setQuery(event.currentTarget.value);
              setCurrentlySelected(0);
            }}
            onKeyDown={handleKeyboardNavigation}
            placeholder={isMoveView ? "Search folders…" : "Search actions…"}
            aria-label={isMoveView ? "Search destination folders" : "Search actions"}
            aria-autocomplete="list"
            aria-controls="action-runner-results"
            aria-expanded="true"
            aria-activedescendant={results[currentlySelected] ? `action-runner-result-${currentlySelected}` : undefined}
            role="combobox"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {isRunning ? (
            <span className="action-runner-running" aria-live="polite">
              {isMoveView ? "Moving…" : "Linking…"}
            </span>
          ) : query ? (
            <button
              type="button"
              className="search-panel-clear"
              onClick={() => {
                setQuery("");
                setCurrentlySelected(0);
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <IconX aria-hidden="true" />
            </button>
          ) : (
            <SearchKeyHint>{isMoveView ? "Move" : shortcutText("action-menu")}</SearchKeyHint>
          )}
        </div>

        <div className="search-panel-results-shell action-runner-results-shell">
          {results.length ? (
            <>
              {isPickerView ? (
                <div className="search-panel-results-heading">
                  <span>{"Choose a destination"}</span>
                </div>
              ) : null}
              <div className="search-panel-results" id="action-runner-results" role="listbox">
                {isMoveView
                  ? destinationResults.map((directory, index) => (
                      <button
                        key={directory.path}
                        id={`action-runner-result-${index}`}
                        ref={(element) => {
                          listRefs.current[index] = element;
                        }}
                        type="button"
                        className="search-panel-result action-runner-result"
                        data-selected={currentlySelected === index ? "true" : undefined}
                        aria-selected={currentlySelected === index}
                        role="option"
                        disabled={isRunning}
                        onClick={() => void moveToDestination(directory)}
                        onMouseMove={() => {
                          mouseNavigationRef.current = true;
                          setCurrentlySelected(index);
                        }}
                      >
                        <span className="search-panel-file-icon">
                          <IconFolder aria-hidden="true" />
                        </span>
                        <span className="search-panel-result-copy">
                          <span className="search-panel-result-title">
                            <SearchHighlightedText query={query} text={directory.filename} />
                          </span>
                          <span className="search-panel-result-path">
                            <SearchHighlightedText query={query} text={destinationParent(directory)} />
                          </span>
                        </span>
                      </button>
                    ))
                  : showCommandGroups
                    ? commandGroups.map(({ commands: groupedCommands, purpose }) => {
                        const headingId = `action-runner-group-${purpose.toLocaleLowerCase().replaceAll(/[^a-z]+/gu, "-")}`;
                        return (
                          <section
                            key={purpose}
                            className="action-runner-command-group"
                            role="group"
                            aria-labelledby={headingId}
                          >
                            <div id={headingId} className="action-runner-command-group-heading">
                              {purpose}
                            </div>
                            {groupedCommands.map((command) =>
                              renderCommand(command, commandResultIndexes.get(command.id)!),
                            )}
                          </section>
                        );
                      })
                    : displayedCommandResults.map(renderCommand)}
              </div>
            </>
          ) : (
            <div className="search-panel-empty action-runner-empty">
              {isMoveView ? <IconFolder aria-hidden="true" /> : <IconTerminal aria-hidden="true" />}
              <strong>{isMoveView ? "No folders found" : "No actions found"}</strong>
              <span>
                {isMoveView
                  ? "Try another folder name or path. Invalid destinations are hidden."
                  : "Try a command name or a related word."}
              </span>
            </div>
          )}
        </div>

        <div className="search-panel-footer">
          <span className="search-panel-shortcuts">
            <span>
              <SearchKeyHint>↑↓</SearchKeyHint> Navigate
            </span>
            <span>
              <SearchKeyHint>↵</SearchKeyHint> {isMoveView ? "Move" : "Run"}
            </span>
            <span>
              <SearchKeyHint>esc</SearchKeyHint>{" "}
              {request.view !== "commands" && request.returnToCommands ? "Back" : "Close"}
            </span>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ActionRunner;
