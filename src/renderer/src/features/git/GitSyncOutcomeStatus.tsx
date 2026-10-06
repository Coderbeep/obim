import { useEffect, useRef, useState } from "react";
import type { GitSyncOutcome } from "@shared/git";
import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import { Button } from "@renderer/shared/ui/button";

/** Local Git cleanliness never erases a failed remote upload. */
export const GitSyncOutcomeStatus = () => {
  const [outcome, setOutcome] = useState<GitSyncOutcome | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const currentWorkspace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (typeof window.api.getGitSyncOutcome !== "function") return;
    let generation = 0;
    let alive = true;
    const refresh = async () => {
      const request = ++generation;
      const result = await window.api.getGitSyncOutcome().catch(() => null);
      if (alive && request === generation) {
        if (currentWorkspace.current !== result?.workspacePath) {
          setRetryError(null);
          setRetrying(false);
        }
        currentWorkspace.current = result?.workspacePath;
        setOutcome(result);
      }
    };
    void refresh();
    const unsubscribe = window.api.onGitSyncOutcomeChanged?.(() => void refresh());
    const unsubscribeGit = window.api.onGitFileStatusChanged?.(() => void refresh());
    return () => {
      alive = false;
      currentWorkspace.current = undefined;
      unsubscribe?.();
      unsubscribeGit?.();
    };
  }, []);
  if (!outcome) return null;
  const pendingCommit = Boolean(outcome.localRevision && outcome.localRevision !== outcome.uploadedRevision);
  const retry = async () => {
    const workspacePath = outcome.workspacePath;
    setRetrying(true);
    setRetryError(null);
    try {
      const result = await workspaceMutationApi.runGitAutoSync();
      if (result.status === "failed" && currentWorkspace.current === workspacePath) setRetryError(result.error);
    } catch {
      if (currentWorkspace.current === workspacePath)
        setRetryError("Synchronization could not start. Try again after the current action finishes.");
    } finally {
      if (currentWorkspace.current === workspacePath) setRetrying(false);
    }
  };
  const cancel = async () => {
    const workspacePath = outcome.workspacePath;
    try {
      await window.api.cancelGitSync();
    } catch {
      if (currentWorkspace.current === workspacePath)
        setRetryError("Synchronization could not be cancelled. Try again.");
    }
  };
  return (
    <div className="source-control-notice" role="status" aria-live="polite">
      <strong>
        {outcome.phase === "running"
          ? "Synchronizing this workspace…"
          : outcome.phase === "failed"
            ? "This workspace did not finish syncing."
            : "Last synchronization finished."}
      </strong>
      {outcome.error ? <p>{outcome.error}</p> : null}
      {outcome.localCommitCreated && outcome.phase === "failed" ? (
        <p>A local version was created before the failure.</p>
      ) : null}
      {pendingCommit ? <p>Local versions still need a confirmed upload.</p> : null}
      {outcome.uncommittedChanges ? <p>Current file changes remain local.</p> : null}
      {outcome.lastUploadedAt ? (
        <p>Last confirmed upload: {new Date(outcome.lastUploadedAt).toLocaleString()}.</p>
      ) : null}
      {outcome.phase === "running" ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void cancel()}>
          Cancel sync
        </Button>
      ) : null}
      {outcome.phase === "failed" ? (
        <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={() => void retry()}>
          {retrying ? "Retrying…" : "Retry sync"}
        </Button>
      ) : null}
      {retryError ? <p>{retryError}</p> : null}
    </div>
  );
};
