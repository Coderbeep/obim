import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import { IconCheck, IconDiffSplit, IconRefresh } from "@pierre/icons";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { getWorkspacePath } from "@renderer/config";
import { reloadGitChangedFiles } from "@renderer/features/git/reloadGitChangedFiles";
import { Button } from "@renderer/shared/ui/button";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import type { GitConflictPreviewResult, GitConflictResolution, GitConflictVersionPreview } from "@shared/git";
import type { GitConflictWorkspaceItem } from "@shared/workspace";

import "./GitConflictResolutionView.css";

type ConflictViewState =
  | { status: "loading" }
  | { status: "ready"; preview: Extract<GitConflictPreviewResult, { status: "ready" }> }
  | { status: "resolved" }
  | { status: "failed"; error: string; retryable?: boolean };

const formatBytes = (sizeBytes: number) => {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

const VersionPreview = ({ label, version }: { label: string; version: GitConflictVersionPreview }) => (
  <section className="git-conflict-version" aria-label={label}>
    <div className="git-conflict-version-heading">
      <strong>{label}</strong>
      {"sizeBytes" in version ? <span>{formatBytes(version.sizeBytes)}</span> : null}
    </div>
    {version.status === "ready" ? <pre className="git-conflict-document">{version.content}</pre> : null}
    {version.status === "deleted" ? (
      <div className="git-conflict-version-state">
        <strong>Deleted on this side</strong>
        <span>Choosing this version will remove the file from the prepared working files.</span>
      </div>
    ) : null}
    {version.status === "binary" ? (
      <div className="git-conflict-version-state">
        <strong>Preview unavailable</strong>
        <span>This file is not text, but you can still choose or preserve this version.</span>
      </div>
    ) : null}
    {version.status === "too-large" ? (
      <div className="git-conflict-version-state">
        <strong>Too large to preview</strong>
        <span>The resolution step will verify whether this version can be applied safely.</span>
      </div>
    ) : null}
  </section>
);

export const GitConflictResolutionView = ({ item }: { item: GitConflictWorkspaceItem }) => {
  const store = useStore();
  const workspacePath = getWorkspacePath();
  const fileTree = useAtomValue(fileTreeAtom);
  const [viewState, setViewState] = useState<ConflictViewState>({ status: "loading" });
  const [busyChoice, setBusyChoice] = useState<GitConflictResolution | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const snapshot = await window.api.getGitFileStatus(true);
      if (snapshot.status !== "ready") {
        setViewState({
          status: "failed",
          error: snapshot.status === "unavailable" ? snapshot.error : "Version history is not enabled.",
        });
        return;
      }
      const conflict = snapshot.changes.find((change) => change.path === item.relativePath && change.conflicted);
      if (!snapshot.remoteReconciliationInProgress || !conflict) {
        setViewState({ status: "resolved" });
        return;
      }
      if (typeof window.api.getGitConflictPreview !== "function") {
        setViewState({
          status: "failed",
          error: "Restart Obim to finish loading the conflict comparison feature, then open this file again.",
          retryable: false,
        });
        return;
      }
      const preview = await window.api.getGitConflictPreview({ path: item.relativePath });
      setViewState(preview.status === "ready" ? { status: "ready", preview } : preview);
    } catch (error) {
      console.error("Unable to load conflicted versions:", error);
      const message = error instanceof Error ? error.message : "";
      setViewState({
        status: "failed",
        error: /no handler registered|get-git-conflict-preview/iu.test(message)
          ? "Restart Obim to finish loading the conflict comparison feature, then open this file again."
          : message || "The local and remote versions could not be loaded.",
        retryable: !/no handler registered|get-git-conflict-preview/iu.test(message),
      });
    }
  }, [item.relativePath]);

  useEffect(() => {
    setViewState({ status: "loading" });
    setFeedback(null);
    void load();
    return window.api.onGitFileStatusChanged(() => void load());
  }, [load]);

  const resolve = async (resolution: GitConflictResolution) => {
    if (viewState.status !== "ready" || busyChoice) return;
    const currentBuffer = store.get(fileBuffersByPathAtom)[item.path];
    if (currentBuffer && currentBuffer.editorText !== currentBuffer.savedText) {
      setFeedback({
        kind: "error",
        text: `Save or discard editor changes to ${item.relativePath} before choosing a version.`,
      });
      return;
    }

    const selectedVersion =
      resolution === "keep-local"
        ? viewState.preview.local
        : resolution === "use-remote"
          ? viewState.preview.remote
          : undefined;
    if (
      selectedVersion?.status === "deleted" &&
      !window.confirm(
        `Keep the ${resolution === "keep-local" ? "local" : "remote"} deletion for ${item.relativePath}? The file will be removed from the prepared working files. Nothing will be staged, committed, or pushed.`,
      )
    ) {
      return;
    }

    const buffersBeforeOperation = store.get(fileBuffersByPathAtom);
    setBusyChoice(resolution);
    setFeedback(null);
    try {
      const result = await workspaceMutationApi.resolveGitConflict({ path: item.relativePath, resolution });
      if (result.status === "failed") {
        setFeedback({ kind: "error", text: result.error });
        return;
      }
      const skipped = await reloadGitChangedFiles({
        buffersBeforeOperation,
        changes: result.changedPaths,
        fileTree,
        store,
        workspacePath,
      });
      const remaining = result.snapshot.changes.filter((change) => change.conflicted).length;
      const choiceText =
        resolution === "keep-local"
          ? "The local version was kept."
          : resolution === "use-remote"
            ? "The remote version was kept."
            : `Both versions were kept. The remote copy is ${result.savedBothPath}.`;
      setViewState({ status: "resolved" });
      setFeedback({
        kind: skipped > 0 ? "error" : "success",
        text:
          skipped > 0
            ? `${choiceText} An open editor changed during the operation; review it before saving.`
            : remaining > 0
              ? `${choiceText} ${remaining} ${remaining === 1 ? "file still needs" : "files still need"} a choice.`
              : `${choiceText} All conflicts are resolved. Review the result and stage any resulting changes when ready.`,
      });
    } catch (error) {
      console.error("Conflict resolution failed:", error);
      setFeedback({ kind: "error", text: "Git could not apply that conflict choice." });
    } finally {
      setBusyChoice(null);
    }
  };

  const canSaveBoth =
    viewState.status === "ready" &&
    viewState.preview.local.status !== "deleted" &&
    viewState.preview.remote.status !== "deleted";

  return (
    <div className="git-conflict-view" aria-label={`Resolve conflict for ${item.relativePath}`}>
      <header className="git-conflict-toolbar">
        <div className="git-conflict-toolbar-title">
          <IconDiffSplit size={17} />
          <div>
            <strong>Resolve conflict</strong>
            <span>{item.relativePath}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Reload local and remote versions"
          title="Reload"
          disabled={Boolean(busyChoice)}
          onClick={() => {
            setViewState({ status: "loading" });
            setFeedback(null);
            void load();
          }}
        >
          <IconRefresh size={14} />
        </Button>
      </header>

      {viewState.status === "loading" ? (
        <div className="git-conflict-state" role="status">
          Loading local and remote versions…
        </div>
      ) : null}
      {viewState.status === "failed" ? (
        <div className="git-conflict-state" role="alert">
          <strong>Comparison unavailable</strong>
          <span>{viewState.error}</span>
          {viewState.retryable !== false ? (
            <Button type="button" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {viewState.status === "resolved" ? (
        <div className="git-conflict-state">
          <IconCheck size={24} />
          <strong>This file no longer has a conflict</strong>
          <span>The result remains unstaged. Continue from Version History to review the other files.</span>
        </div>
      ) : null}
      {viewState.status === "ready" ? (
        <>
          <div className="git-conflict-comparison">
            <VersionPreview label="Local version" version={viewState.preview.local} />
            <VersionPreview label="Remote version" version={viewState.preview.remote} />
          </div>
          <footer className="git-conflict-actions">
            <div>
              <strong>Choose what to keep</strong>
              <span>The result stays unstaged. Nothing is committed or pushed automatically.</span>
            </div>
            <div className="git-conflict-buttons">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busyChoice)}
                onClick={() => void resolve("keep-local")}
              >
                {busyChoice === "keep-local" ? "Keeping local…" : "Keep local"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busyChoice)}
                onClick={() => void resolve("use-remote")}
              >
                {busyChoice === "use-remote" ? "Keeping remote…" : "Keep remote"}
              </Button>
              <Button
                type="button"
                disabled={Boolean(busyChoice) || !canSaveBoth}
                title={
                  canSaveBoth
                    ? "Keep the local file and save the remote file with a new name"
                    : "Unavailable because one side deleted this file"
                }
                onClick={() => void resolve("save-both")}
              >
                {busyChoice === "save-both" ? "Saving both…" : "Keep both"}
              </Button>
            </div>
          </footer>
        </>
      ) : null}

      {feedback ? (
        <p
          className="git-conflict-feedback"
          data-kind={feedback.kind}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
};
