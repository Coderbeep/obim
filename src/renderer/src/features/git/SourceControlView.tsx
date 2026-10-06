import { GitSyncOutcomeStatus } from "./GitSyncOutcomeStatus";
import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import {
  IconApp,
  IconArrowUpRight,
  IconCheck,
  IconCommit,
  IconDownload,
  IconMinus,
  IconPlus,
  IconRefresh,
  IconReply,
} from "@pierre/icons";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { getWorkspacePath } from "@renderer/config";
import { saveDirtyFileBuffers } from "@renderer/features/files/dirtyFileBuffers";
import { findItemNode } from "@renderer/features/files/fileTreeUtils";
import { reloadGitChangedFiles } from "@renderer/features/git/reloadGitChangedFiles";
import { useFileHistoryOpen } from "@renderer/features/git/useFileHistoryOpen";
import { getFileGlyph } from "@renderer/shared/icons/FileGlyphs";
import { IconGitBranch } from "@renderer/shared/icons/IconGitBranch";
import { Button } from "@renderer/shared/ui/button";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import { fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { activateWorkspaceResourceAtom } from "@renderer/store/workspaceActionStore";
import type { FileItem } from "@shared/file-item";
import type {
  GitFileChange,
  GitFileStatusSnapshot,
  GitOperationResult,
  GitRemoteSyncOperationResult,
  GitRemoteSyncStatus,
} from "@shared/git";
import { isApplicationGitPath, isGitChangeRevertible } from "@shared/git";
import { basename, getPathWithoutFilename, getRelativePathFromPath, joinFsPath } from "@shared/pathUtils";
import { createGitConflictWorkspaceItem } from "@shared/workspace";

import "./SourceControlView.css";
import "./SourceControlSurfaces.css";

const isStaged = (change: GitFileChange) => change.staged;
const isWorkingTreeChange = (change: GitFileChange) => change.workingTreeChanged && !change.conflicted;

const STATUS_LABELS = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
} as const;

const remoteStatusText = (sync: GitRemoteSyncStatus) => {
  if (sync.status === "not-configured") return "Connect an origin in Settings to upload committed versions.";
  if (sync.status === "unavailable") return sync.error;
  if (sync.state === "no-local-commits") return "Create a local commit before publishing this workspace.";
  if (sync.state === "unpublished") return `${sync.branch} is ready to publish to the empty remote.`;
  if (sync.state === "branch-missing") return `Origin does not have a matching ${sync.branch} branch.`;
  if (sync.state === "ahead")
    return `${sync.ahead} local ${sync.ahead === 1 ? "commit is" : "commits are"} ready to push.`;
  if (sync.state === "behind")
    return `${sync.behind} remote ${sync.behind === 1 ? "commit is" : "commits are"} ready to pull.`;
  if (sync.state === "diverged") {
    return "Local and remote commits both contain changes. Review the differences before pushing.";
  }
  return "Local and remote commits are up to date.";
};

interface ChangeSectionProps {
  action: "stage" | "unstage";
  busy: boolean;
  changes: GitFileChange[];
  emptyLabel?: string;
  fileForChange: (change: GitFileChange) => FileItem | null;
  onAction: (paths: string[]) => void;
  onOpen: (file: FileItem) => void;
  onRevert: (changes: GitFileChange[], label: string) => void;
  revertBlockReason: (changes: GitFileChange[]) => string | null;
  title: string;
}

const ChangeSection = ({
  action,
  busy,
  changes,
  emptyLabel,
  fileForChange,
  onAction,
  onOpen,
  onRevert,
  revertBlockReason,
  title,
}: ChangeSectionProps) => {
  const actionLabel = action === "stage" ? "Stage" : "Unstage";
  const ActionIcon = action === "stage" ? IconPlus : IconMinus;
  const applicationChanges = changes.filter((change) => isApplicationGitPath(change.path));
  const visibleChanges = changes.filter((change) => !isApplicationGitPath(change.path));
  const applicationRevertBlockReason = revertBlockReason(applicationChanges);

  return (
    <section className="source-control-section" aria-label={title}>
      <div className="source-control-section-heading">
        <span>{title}</span>
        <span className="source-control-section-count">{changes.length}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="source-control-heading-action"
          aria-label={`${actionLabel} all ${title.toLowerCase()}`}
          title={`${actionLabel} all`}
          disabled={busy || changes.length === 0}
          onClick={() => onAction(changes.map((change) => change.path))}
        >
          <ActionIcon size={14} />
        </Button>
      </div>
      <div className="source-control-change-list">
        {applicationChanges.length > 0 ? (
          <div className="source-control-change source-control-application-change">
            <div className="source-control-change-open source-control-application-summary">
              <IconApp size={14} />
              <span className="source-control-change-label">
                <span className="source-control-change-name">Application configuration</span>
                <span className="source-control-change-directory">
                  {applicationChanges.length === 1
                    ? "1 application-managed file"
                    : `${applicationChanges.length} application-managed files`}
                </span>
              </span>
              <span className="source-control-application-badge" aria-label="Application managed">
                App
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="source-control-change-action source-control-revert-action"
              aria-label="Revert application configuration changes"
              title={applicationRevertBlockReason ?? "Revert changes"}
              disabled={busy || Boolean(applicationRevertBlockReason)}
              onClick={() => onRevert(applicationChanges, "the application configuration")}
            >
              <IconReply size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="source-control-change-action"
              aria-label={`${actionLabel} application configuration`}
              title={actionLabel}
              disabled={busy}
              onClick={() => onAction(applicationChanges.map((change) => change.path))}
            >
              <ActionIcon size={14} />
            </Button>
          </div>
        ) : null}
        {visibleChanges.map((change) => {
          const file = fileForChange(change);
          const directory = getPathWithoutFilename(change.path);
          const changeRevertBlockReason = revertBlockReason([change]);
          return (
            <div key={`${action}:${change.path}`} className="source-control-change" data-kind={change.kind}>
              <button
                type="button"
                className="source-control-change-open"
                title={file ? `View history for ${change.path}` : change.path}
                aria-label={file ? `View history for ${change.path}` : change.path}
                disabled={!file}
                onClick={() => file && onOpen(file)}
              >
                {getFileGlyph(change.path)}
                <span className="source-control-change-label">
                  <span className="source-control-change-name">{basename(change.path)}</span>
                  {directory ? <span className="source-control-change-directory">{directory}</span> : null}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="source-control-change-action source-control-revert-action"
                aria-label={`Revert changes to ${change.path}`}
                title={changeRevertBlockReason ?? "Revert changes"}
                disabled={busy || Boolean(changeRevertBlockReason)}
                onClick={() => onRevert([change], change.path)}
              >
                <IconReply size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="source-control-change-action"
                aria-label={`${actionLabel} ${change.path}`}
                title={actionLabel}
                disabled={busy}
                onClick={() => onAction([change.path])}
              >
                <ActionIcon size={14} />
              </Button>
              <span className="source-control-change-status" aria-label={change.kind}>
                {STATUS_LABELS[change.kind]}
              </span>
            </div>
          );
        })}
        {changes.length === 0 ? (
          <div className="source-control-section-empty">
            <IconCheck size={14} />
            <span>{emptyLabel ?? "No changes"}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
};

const ConflictSection = ({
  busy,
  changes,
  onOpen,
}: {
  busy: boolean;
  changes: GitFileChange[];
  onOpen: (change: GitFileChange) => void;
}) => (
  <section className="source-control-section" aria-label="Conflicts">
    <div className="source-control-section-heading source-control-section-heading-without-action">
      <span>Conflicts</span>
      <span className="source-control-section-count">{changes.length}</span>
    </div>
    <div className="source-control-change-list">
      {changes.map((change) => {
        const directory = getPathWithoutFilename(change.path);
        const sideStatus = !change.conflict?.localExists
          ? "Deleted locally"
          : !change.conflict?.remoteExists
            ? "Deleted remotely"
            : directory;
        return (
          <div key={change.path} className="source-control-change" data-kind="conflicted">
            <button
              type="button"
              className="source-control-change-open"
              title={`Reconcile ${change.path}`}
              aria-label={`Reconcile ${change.path}`}
              disabled={busy}
              onClick={() => onOpen(change)}
            >
              {getFileGlyph(change.path)}
              <span className="source-control-change-label">
                <span className="source-control-change-name">{basename(change.path)}</span>
                {sideStatus ? <span className="source-control-change-directory">{sideStatus}</span> : null}
              </span>
            </button>
            <span className="source-control-change-status" aria-label="conflicted">
              {STATUS_LABELS.conflicted}
            </span>
          </div>
        );
      })}
    </div>
  </section>
);

export const SourceControlView = () => {
  const store = useStore();
  const workspacePath = getWorkspacePath();
  const fileTree = useAtomValue(fileTreeAtom);
  const fileBuffers = useAtomValue(fileBuffersByPathAtom);
  const fileSaveStates = useAtomValue(fileSaveStatesByPathAtom);
  const setFileBuffers = useSetAtom(fileBuffersByPathAtom);
  const setFileSaveStates = useSetAtom(fileSaveStatesByPathAtom);
  const activateResource = useSetAtom(activateWorkspaceResourceAtom);
  const { openFileHistory } = useFileHistoryOpen();
  const [snapshot, setSnapshot] = useState<GitFileStatusSnapshot | null>(null);
  const [remoteSync, setRemoteSync] = useState<GitRemoteSyncStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [editorChangesAwaitingGit, setEditorChangesAwaitingGit] = useState<Set<string>>(() => new Set());
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshPendingRef = useRef(false);
  const forceRefreshPendingRef = useRef(false);
  const remoteRefreshPendingRef = useRef(false);
  const indicatorRefreshPendingRef = useRef(false);
  const stateGenerationRef = useRef(0);

  const applyAuthoritativeState = useCallback(
    (nextSnapshot: GitFileStatusSnapshot, nextRemoteSync?: GitRemoteSyncStatus) => {
      stateGenerationRef.current += 1;
      setSnapshot(nextSnapshot);
      setEditorChangesAwaitingGit((current) => (current.size === 0 ? current : new Set()));
      if (nextRemoteSync) setRemoteSync(nextRemoteSync);
    },
    [],
  );

  const refresh = useCallback((forceRefresh = false, includeRemote = true, showIndicator = true) => {
    if (refreshPromiseRef.current) {
      refreshPendingRef.current = true;
      forceRefreshPendingRef.current ||= forceRefresh;
      remoteRefreshPendingRef.current ||= includeRemote;
      indicatorRefreshPendingRef.current ||= showIndicator;
      return refreshPromiseRef.current;
    }
    const stateGeneration = stateGenerationRef.current;
    if (showIndicator) setRefreshing(true);
    const statusRequest = window.api.getGitFileStatus(forceRefresh).then(
      (result) => {
        if (stateGeneration !== stateGenerationRef.current) return;
        setSnapshot(result);
        setEditorChangesAwaitingGit((current) => (current.size === 0 ? current : new Set()));
      },
      (error: unknown) => {
        if (stateGeneration !== stateGenerationRef.current) return;
        console.error("Unable to refresh Version History:", error);
        setSnapshot({ status: "unavailable", changes: [], error: "Git status is unavailable." });
      },
    );
    const remoteRequest = includeRemote
      ? window.api.getGitRemoteSyncStatus().then(
          (result) => {
            if (stateGeneration === stateGenerationRef.current) setRemoteSync(result);
          },
          (error: unknown) => {
            if (stateGeneration !== stateGenerationRef.current) return;
            console.error("Unable to refresh remote status:", error);
            const message = error instanceof Error ? error.message : "";
            setRemoteSync({
              status: "unavailable",
              error: /no handler registered|get-git-remote-sync-status/iu.test(message)
                ? "Restart Obim to finish loading remote sync."
                : message || "Remote status is unavailable.",
            });
          },
        )
      : Promise.resolve();
    const request = Promise.all([statusRequest, remoteRequest]).then(() => undefined);
    refreshPromiseRef.current = request;
    void request.finally(() => {
      if (refreshPromiseRef.current !== request) return;
      refreshPromiseRef.current = null;
      if (refreshPendingRef.current) {
        const forcePending = forceRefreshPendingRef.current;
        const remotePending = remoteRefreshPendingRef.current;
        const showPendingIndicator = indicatorRefreshPendingRef.current;
        refreshPendingRef.current = false;
        forceRefreshPendingRef.current = false;
        remoteRefreshPendingRef.current = false;
        indicatorRefreshPendingRef.current = false;
        if (!showPendingIndicator) setRefreshing(false);
        void refresh(forcePending, remotePending, showPendingIndicator);
      } else {
        setRefreshing(false);
      }
    });
    return request;
  }, []);

  useEffect(() => {
    void refresh();
    return window.api.onGitFileStatusChanged(() => void refresh(false, true, false));
  }, [refresh]);

  const manuallyRefresh = async () => {
    setBusyAction("refresh");
    setFeedback(null);
    try {
      if (remoteSync?.status === "ready") {
        const result = await workspaceMutationApi.fetchGitRemote();
        if (result.status === "failed") {
          setFeedback({ kind: "error", text: result.error });
          return;
        }
        applyAuthoritativeState(result.snapshot, result.sync);
      } else {
        await refresh(true);
      }
    } catch (error) {
      console.error("Unable to refresh Version History:", error);
      setFeedback({ kind: "error", text: "Version History could not refresh local and remote status." });
    } finally {
      setBusyAction(null);
    }
  };

  const applyOperation = async (label: string, operation: () => Promise<GitOperationResult>) => {
    setBusyAction(label);
    setFeedback(null);
    try {
      const result = await operation();
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return false;
      }
      applyAuthoritativeState(result.snapshot);
      return true;
    } catch (error) {
      console.error(`Source Control ${label} failed:`, error);
      setFeedback({ kind: "error", text: "Source Control could not complete that action." });
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const applyRemoteOperation = async (
    label: string,
    operation: () => Promise<GitRemoteSyncOperationResult>,
  ): Promise<Extract<GitRemoteSyncOperationResult, { status: "succeeded" }> | null> => {
    setBusyAction(label);
    setFeedback(null);
    try {
      const result = await operation();
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return null;
      }
      applyAuthoritativeState(result.snapshot, result.sync);
      return result;
    } catch (error) {
      console.error(`Remote ${label} failed:`, error);
      setFeedback({ kind: "error", text: "Git could not complete the remote action." });
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  const initialize = async () => {
    setFeedback(null);
    if (
      !window.confirm(
        "Start local version history for this workspace? This creates a private local Git repository. Files will remain unstaged and nothing is uploaded.",
      )
    )
      return;

    setBusyAction("initialize");
    try {
      const result = await workspaceMutationApi.initializeGitRepository();
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      applyAuthoritativeState(result.snapshot, { status: "not-configured" });
      setFeedback({ kind: "success", text: "Version history started. Choose files to stage for the first commit." });
    } catch (error) {
      console.error("Unable to initialize Git:", error);
      setFeedback({ kind: "error", text: "Git could not initialize this workspace." });
    } finally {
      setBusyAction(null);
    }
  };

  const readySnapshot = snapshot?.status === "ready" ? snapshot : null;
  const dirtyEditorPaths = useMemo(
    () =>
      Object.entries(fileBuffers).flatMap(([filePath, buffer]) => {
        if (buffer.savedText === buffer.editorText) return [];
        try {
          const relativePath = getRelativePathFromPath(filePath, workspacePath).replaceAll("\\", "/");
          return relativePath ? [relativePath] : [];
        } catch {
          return [];
        }
      }),
    [fileBuffers, workspacePath],
  );
  const previousDirtyEditorPathsRef = useRef<Set<string>>(new Set());
  useLayoutEffect(() => {
    const currentDirtyPaths = new Set(dirtyEditorPaths);
    const savedPaths = [...previousDirtyEditorPathsRef.current].filter((path) => {
      if (currentDirtyPaths.has(path)) return false;
      const saveState = fileSaveStates[joinFsPath(workspacePath, path)];
      return saveState?.phase === "saving" || saveState?.phase === "saved";
    });
    previousDirtyEditorPathsRef.current = currentDirtyPaths;
    if (savedPaths.length === 0) return;

    stateGenerationRef.current += 1;
    setEditorChangesAwaitingGit((current) => {
      const next = new Set(current);
      for (const path of savedPaths) next.add(path);
      return next;
    });
    void refresh(true, false, false);
  }, [dirtyEditorPaths, fileSaveStates, refresh, workspacePath]);
  const displayedChanges = useMemo(() => {
    if (!readySnapshot) return [];
    const changes = new Map(readySnapshot.changes.map((change) => [change.path, change]));
    for (const path of [...dirtyEditorPaths, ...editorChangesAwaitingGit]) {
      const existing = changes.get(path);
      changes.set(
        path,
        existing
          ? { ...existing, workingTreeChanged: true }
          : { conflicted: false, kind: "modified", path, staged: false, workingTreeChanged: true },
      );
    }
    return [...changes.values()];
  }, [dirtyEditorPaths, editorChangesAwaitingGit, readySnapshot]);
  const stagedChanges = useMemo(() => displayedChanges.filter(isStaged), [displayedChanges]);
  const workingTreeChanges = useMemo(() => displayedChanges.filter(isWorkingTreeChange), [displayedChanges]);
  const conflictedChanges = useMemo(
    () => readySnapshot?.changes.filter((change) => change.conflicted) ?? [],
    [readySnapshot],
  );
  const readOnly = readySnapshot?.repositoryScope === "ancestor";
  const busy = busyAction !== null;

  const fileForChange = useCallback(
    (change: GitFileChange) => findItemNode(fileTree, joinFsPath(workspacePath, change.path)),
    [fileTree, workspacePath],
  );
  const openConflict = useCallback(
    (change: GitFileChange) => {
      const item = createGitConflictWorkspaceItem(joinFsPath(workspacePath, change.path), change.path);
      activateResource({ item, resourceKey: item.key });
    },
    [activateResource, workspacePath],
  );
  const revertBlockReason = useCallback(
    (changes: GitFileChange[]) => {
      if (changes.length === 0) return null;
      if (readySnapshot?.mergeInProgress) return "Cancel reconciliation to restore the local branch";
      if (changes.some((change) => !isGitChangeRevertible(change))) {
        return "No committed version is available for new files";
      }
      for (const change of changes) {
        const paths = [change.path, change.originalPath].filter((path): path is string => Boolean(path));
        for (const relativePath of paths) {
          const buffer = fileBuffers[joinFsPath(workspacePath, relativePath)];
          if (buffer && buffer.editorText !== buffer.savedText)
            return "Save or discard editor changes before reverting";
          if (buffer && change.originalPath) return "Close this renamed note before reverting";
        }
      }
      return null;
    },
    [fileBuffers, readySnapshot?.mergeInProgress, workspacePath],
  );
  const persistDirtyEditorPaths = (paths?: readonly string[]) => {
    const selectedPaths = paths ? new Set(paths) : null;
    return saveDirtyFileBuffers(store, (filePath) => {
      try {
        const relativePath = getRelativePathFromPath(filePath, workspacePath).replaceAll("\\", "/");
        return !selectedPaths || selectedPaths.has(relativePath);
      } catch {
        return false;
      }
    });
  };
  const stage = (paths: string[]) =>
    void applyOperation("stage", async () => {
      const persisted = await persistDirtyEditorPaths(paths);
      if (!persisted.success) return { status: "failed", error: persisted.error };
      return workspaceMutationApi.stageGitPaths(paths);
    });
  const unstage = (paths: string[]) =>
    void applyOperation("unstage", () => workspaceMutationApi.unstageGitPaths(paths));
  const reloadRevertedBuffers = async (changes: GitFileChange[]) => {
    const bufferedChanges = changes.filter(
      (change) => !change.originalPath && Boolean(fileBuffers[joinFsPath(workspacePath, change.path)]),
    );
    const refreshedBuffers = await Promise.all(
      bufferedChanges.map(async (change) => {
        const filePath = joinFsPath(workspacePath, change.path);
        try {
          return { filePath, file: await window.api.openTextFile(filePath) };
        } catch {
          return null;
        }
      }),
    );
    const availableBuffers = refreshedBuffers.filter((result): result is NonNullable<typeof result> => Boolean(result));
    if (availableBuffers.length === 0) return;
    setFileBuffers((current) => {
      const next = { ...current };
      for (const { filePath, file } of availableBuffers) {
        next[filePath] = { editorText: file.content, savedText: file.content, version: file.version };
      }
      return next;
    });
    setFileSaveStates((current) => {
      const next = { ...current };
      for (const { filePath } of availableBuffers) next[filePath] = { phase: "saved", savedAt: Date.now() };
      return next;
    });
  };
  const revert = async (changes: GitFileChange[], label: string) => {
    if (busy || readOnly || revertBlockReason(changes)) return;
    if (
      !window.confirm(
        `Revert all staged and unstaged changes to ${label}? This restores the last committed version and cannot be undone.`,
      )
    ) {
      return;
    }
    const reverted = await applyOperation("revert", () =>
      workspaceMutationApi.revertGitPaths(changes.map((change) => change.path)),
    );
    if (!reverted) return;
    await reloadRevertedBuffers(changes);
    setFeedback({ kind: "success", text: "Changes reverted to the last commit." });
  };
  const commit = async () => {
    const mergeInProgress = Boolean(readySnapshot?.mergeInProgress);
    const unresolvedMerge = Boolean(
      mergeInProgress && readySnapshot?.changes.some((change) => change.conflicted || change.workingTreeChanged),
    );
    if (
      !commitMessage.trim() ||
      unresolvedMerge ||
      (!mergeInProgress && stagedChanges.length === 0) ||
      readOnly ||
      busy
    )
      return;
    const committed = await applyOperation("commit", () => workspaceMutationApi.commitGitChanges(commitMessage));
    if (committed) {
      setCommitMessage("");
      try {
        setRemoteSync(await window.api.getGitRemoteSyncStatus());
      } catch (error) {
        console.error("Unable to refresh remote status after committing:", error);
      }
      setFeedback({
        kind: "success",
        text: "Commit created locally.",
      });
    }
  };

  const reloadRemoteChangedBuffers = (
    changes: Parameters<typeof reloadGitChangedFiles>[0]["changes"],
    buffersBeforeOperation: typeof fileBuffers,
  ) => reloadGitChangedFiles({ buffersBeforeOperation, changes, fileTree, store, workspacePath });

  const pullRemote = async () => {
    if (dirtyEditorPaths.length > 0) {
      setFeedback({ kind: "error", text: "Save or discard editor changes before pulling from the remote." });
      return;
    }
    if (
      !window.confirm(
        "Pull remote commits into this workspace? Obim will proceed only when the update is a clean fast-forward. It will not merge, rebase, reset, or overwrite local changes.",
      )
    ) {
      return;
    }
    const buffersBeforePull = store.get(fileBuffersByPathAtom);
    const result = await applyRemoteOperation("pull", () => workspaceMutationApi.pullGitRemote());
    if (!result) return;
    if (result.action !== "pulled") {
      setFeedback({ kind: "success", text: "No remote commits need to be pulled." });
      return;
    }
    const skipped = await reloadRemoteChangedBuffers(result.changedPaths ?? [], buffersBeforePull);
    setFeedback({
      kind: skipped > 0 ? "error" : "success",
      text:
        skipped > 0
          ? `Remote commits were pulled, but ${skipped} open ${skipped === 1 ? "file changed" : "files changed"} during the operation. Review those editors before saving.`
          : "Remote commits were pulled with a fast-forward update.",
    });
  };

  const beginReconciliation = async () => {
    if (dirtyEditorPaths.length > 0) {
      setFeedback({
        kind: "error",
        text: "Save or discard editor changes before reviewing local and remote differences.",
      });
      return;
    }
    if (displayedChanges.length > 0) {
      setFeedback({
        kind: "error",
        text: "Commit, revert, or remove current changes before reviewing local and remote differences.",
      });
      return;
    }
    const buffersBeforeReconciliation = store.get(fileBuffersByPathAtom);
    const result = await applyRemoteOperation("reconcile", () => workspaceMutationApi.beginGitRemoteReconciliation());
    if (!result || result.action !== "reconciliation-started") return;

    const conflictPaths = new Set(
      result.snapshot.changes.filter((change) => change.conflicted).map((change) => change.path),
    );
    const automaticallyCombinedPaths = (result.changedPaths ?? []).filter((change) => !conflictPaths.has(change.path));
    const skipped = await reloadRemoteChangedBuffers(automaticallyCombinedPaths, buffersBeforeReconciliation);
    const conflictCount = conflictPaths.size;
    if (!commitMessage.trim()) setCommitMessage("Combine local and remote note versions");
    setFeedback({
      kind: skipped > 0 ? "error" : "success",
      text:
        skipped > 0
          ? `Differences are ready for review, but ${skipped} open ${skipped === 1 ? "file changed" : "files changed"} during the operation. Review those editors before continuing.`
          : conflictCount > 0
            ? `${conflictCount} ${conflictCount === 1 ? "file needs" : "files need"} a choice. Nothing has been committed or pushed.`
            : "Local and remote changes were combined without file conflicts. Review and stage the prepared changes, then commit them.",
    });
  };

  const abortReconciliation = async () => {
    if (dirtyEditorPaths.length > 0) {
      setFeedback({
        kind: "error",
        text: "Save or discard editor changes before cancelling reconciliation.",
      });
      return;
    }
    const buffersBeforeAbort = store.get(fileBuffersByPathAtom);
    setBusyAction("abort-reconciliation");
    setFeedback(null);
    try {
      const result = await workspaceMutationApi.abortGitRemoteReconciliation();
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      applyAuthoritativeState(result.snapshot);
      const skipped = await reloadRemoteChangedBuffers(result.changedPaths, buffersBeforeAbort);
      const recoveryText = result.recoveryPaths?.length
        ? ` Edited files were preserved as ${result.recoveryPaths.join(", ")}.`
        : "";
      setFeedback({
        kind: skipped > 0 ? "error" : "success",
        text:
          skipped > 0
            ? `Reconciliation was cancelled, but an open editor changed during the operation. Review it before saving.${recoveryText}`
            : `Reconciliation cancelled. The local branch was restored and the remote was not changed.${recoveryText}`,
      });
    } catch (error) {
      console.error("Unable to cancel reconciliation:", error);
      setFeedback({ kind: "error", text: "Git could not cancel reconciliation safely." });
    } finally {
      setBusyAction(null);
    }
  };

  const pushRemote = async () => {
    if (remoteSync?.status === "ready" && remoteSync.state === "unpublished") {
      const confirmed = window.confirm(
        `Publish the current ${remoteSync.branch} branch to origin? Only committed versions will be uploaded. Uncommitted changes remain local.`,
      );
      if (!confirmed) return;
    }
    const result = await applyRemoteOperation("push", () => workspaceMutationApi.pushGitRemote());
    if (!result) return;
    setFeedback({
      kind: "success",
      text:
        result.action === "up-to-date"
          ? "Remote is already up to date."
          : displayedChanges.length > 0
            ? "Committed versions were pushed. Uncommitted changes remain local."
            : "Committed versions were pushed to origin.",
    });
  };
  const readyRemoteSync = remoteSync?.status === "ready" ? remoteSync : null;
  const canPull = readyRemoteSync?.state === "behind";
  const canPush = readyRemoteSync
    ? readyRemoteSync.state === "ahead" || readyRemoteSync.state === "unpublished"
    : false;
  const canReconcile = readyRemoteSync?.state === "diverged" && !readySnapshot?.mergeInProgress;
  const remoteReconciliationInProgress = Boolean(readySnapshot?.remoteReconciliationInProgress);
  const mergeHasUnstagedChanges = Boolean(
    readySnapshot?.mergeInProgress && readySnapshot.changes.some((change) => change.workingTreeChanged),
  );
  const primaryActionIsPush = Boolean(canPush && !readySnapshot?.mergeInProgress && stagedChanges.length === 0);
  const showIncomingRemoteBlock = readyRemoteSync?.state === "behind" || readyRemoteSync?.state === "diverged";
  const refreshIndicatorActive = refreshing || busyAction === "refresh";
  const showRepositoryInterface = snapshot?.status !== "not-repository";
  return (
    <div className="source-control" aria-label="Version History">
      <header className="source-control-header">
        <div className="source-control-title">
          <IconGitBranch size={15} />
          <span>Version History</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="source-control-refresh"
          aria-label="Refresh Version History"
          aria-busy={refreshIndicatorActive}
          data-refreshing={refreshIndicatorActive ? "true" : undefined}
          title={readySnapshot?.mergeInProgress ? "Finish or cancel reconciliation before refreshing" : "Refresh"}
          disabled={busy || Boolean(readySnapshot?.mergeInProgress)}
          onClick={() => void manuallyRefresh()}
        >
          <IconRefresh size={14} />
        </Button>
      </header>
      <GitSyncOutcomeStatus />

      {snapshot?.status === "unavailable" ? (
        <p className="source-control-notice" role="alert">
          {snapshot.error}
        </p>
      ) : null}
      {snapshot?.status === "not-repository" ? (
        <div className="source-control-empty">
          <IconGitBranch size={22} />
          <strong>Version history is off</strong>
          <span>Start a private local history for this workspace. Nothing is uploaded.</span>
          <Button type="button" disabled={busy} onClick={() => void initialize()}>
            {busyAction === "initialize" ? "Starting…" : "Start version history"}
          </Button>
        </div>
      ) : null}

      {showRepositoryInterface ? (
        <>
          {remoteReconciliationInProgress ? (
            <section className="source-control-reconciliation" aria-label="Reconciliation in progress">
              <div>
                <strong>{conflictedChanges.length > 0 ? "Resolve conflicts" : "Ready to commit"}</strong>
                <span>
                  {conflictedChanges.length > 0
                    ? `${conflictedChanges.length} ${conflictedChanges.length === 1 ? "file needs" : "files need"} a choice`
                    : "Review the resulting changes"}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void abortReconciliation()}
              >
                {busyAction === "abort-reconciliation" ? "Cancelling…" : "Cancel"}
              </Button>
            </section>
          ) : readOnly ? (
            <p className="source-control-notice">
              This workspace is inside a parent repository. Status is visible, but actions are disabled for safety.
            </p>
          ) : null}

          {!readOnly && remoteSync?.status === "unavailable" && !remoteReconciliationInProgress ? (
            <p className="source-control-notice" role="alert">
              {remoteSync.error}
            </p>
          ) : null}

          {!readOnly && readyRemoteSync && showIncomingRemoteBlock && !remoteReconciliationInProgress ? (
            <section className="source-control-remote" aria-label="Remote repository">
              <div className="source-control-remote-summary">
                <strong>Origin</strong>
                {readyRemoteSync ? (
                  <span className="source-control-remote-branch">{readyRemoteSync.branch}</span>
                ) : null}
              </div>
              <p data-state={readyRemoteSync.state}>{remoteStatusText(readyRemoteSync)}</p>
              <div className="source-control-remote-actions">
                {readyRemoteSync.state === "behind" ? (
                  <Button type="button" variant="outline" disabled={busy || !canPull} onClick={() => void pullRemote()}>
                    <IconDownload size={14} />
                    {busyAction === "pull" ? "Pulling…" : "Pull"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="source-control-reconcile"
                    disabled={busy || !canReconcile}
                    onClick={() => void beginReconciliation()}
                  >
                    {busyAction === "reconcile" ? "Opening comparison…" : "Resolve differences"}
                  </Button>
                )}
              </div>
            </section>
          ) : null}

          {!remoteReconciliationInProgress && conflictedChanges.length > 0 ? (
            <section className="source-control-conflicts" aria-label="Merge conflicts">
              <strong>Resolve merge conflicts outside Obim</strong>
              <span>Saving and restore actions are paused to prevent conflict markers from becoming a version.</span>
              <ul>
                {conflictedChanges.map((change) => (
                  <li key={change.path}>{change.path}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {!readOnly ? (
            <div className="source-control-controls">
              {!remoteReconciliationInProgress || conflictedChanges.length === 0 ? (
                <div className="source-control-commit-box">
                  <input
                    type="text"
                    className="source-control-commit-input"
                    value={commitMessage}
                    maxLength={10_000}
                    placeholder="Commit message"
                    aria-label="Commit message"
                    disabled={busy}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (busy) return;
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        if (primaryActionIsPush) void pushRemote();
                        else void commit();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    className="source-control-commit-button"
                    disabled={
                      !readySnapshot
                        ? true
                        : primaryActionIsPush
                          ? busy || !canPush
                          : busy ||
                            conflictedChanges.length > 0 ||
                            mergeHasUnstagedChanges ||
                            (!readySnapshot.mergeInProgress && stagedChanges.length === 0) ||
                            !commitMessage.trim()
                    }
                    onClick={() => {
                      if (primaryActionIsPush) void pushRemote();
                      else void commit();
                    }}
                  >
                    {primaryActionIsPush ? (
                      <IconArrowUpRight size={14} />
                    ) : busyAction === "commit" ? (
                      <IconRefresh size={14} />
                    ) : (
                      <IconCommit size={14} />
                    )}
                    {primaryActionIsPush
                      ? busyAction === "push"
                        ? "Pushing…"
                        : "Push changes"
                      : busyAction === "commit"
                        ? "Committing…"
                        : "Commit staged changes"}
                  </Button>
                </div>
              ) : null}

              <div className="source-control-sections">
                {remoteReconciliationInProgress && conflictedChanges.length > 0 ? (
                  <ConflictSection busy={busy} changes={conflictedChanges} onOpen={openConflict} />
                ) : null}
                {(!remoteReconciliationInProgress || conflictedChanges.length === 0) && stagedChanges.length > 0 ? (
                  <ChangeSection
                    action="unstage"
                    busy={busy || readOnly}
                    changes={stagedChanges}
                    fileForChange={fileForChange}
                    onAction={unstage}
                    onOpen={openFileHistory}
                    onRevert={(changes, label) => void revert(changes, label)}
                    revertBlockReason={revertBlockReason}
                    title="Staged Changes"
                  />
                ) : null}
                {!remoteReconciliationInProgress || conflictedChanges.length === 0 ? (
                  <ChangeSection
                    action="stage"
                    busy={busy || readOnly || !readySnapshot}
                    changes={workingTreeChanges}
                    emptyLabel={
                      snapshot?.status === "unavailable"
                        ? "Changes unavailable"
                        : readySnapshot && displayedChanges.length === 0
                          ? "Working tree is clean"
                          : displayedChanges.length > 0
                            ? "No unstaged changes"
                            : "No changes"
                    }
                    fileForChange={fileForChange}
                    onAction={stage}
                    onOpen={openFileHistory}
                    onRevert={(changes, label) => void revert(changes, label)}
                    revertBlockReason={revertBlockReason}
                    title="Changes"
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {feedback ? (
        <p
          className="source-control-feedback"
          data-kind={feedback.kind}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
};
