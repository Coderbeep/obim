import type { GitSyncOutcome } from "@shared/git";

/** Remote diagnostics may contain credentials even when the configured URL does not. */
export const sanitizeGitSyncError = (message: string) =>
  message
    .replace(/\b(?:https?|ssh|git):\/\/[^\s<>"']+/giu, "[remote URL]")
    .replace(/\b[^\s@]+@[^\s:]+:[^\s]+/gu, "[remote address]")
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(
      /\b(password|token|secret|authorization|access[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      "$1=[redacted]",
    )
    .replace(/[\r\n]+/gu, " ")
    .slice(0, 600);

export interface GitSyncLocalState {
  localRevision?: string;
  uncommittedChanges: boolean;
}

export const completedGitSyncOutcome = ({
  previous,
  after,
  localCommitCreated = false,
  error,
  uploadedRevision,
  source,
  workspacePath,
  startedAt,
}: {
  previous?: GitSyncOutcome;
  before: GitSyncLocalState;
  after: GitSyncLocalState;
  localCommitCreated?: boolean;
  error?: string;
  uploadedRevision?: string;
  source: GitSyncOutcome["source"];
  workspacePath: string;
  startedAt: number;
}): GitSyncOutcome => ({
  workspacePath,
  source,
  startedAt,
  finishedAt: Date.now(),
  phase: error ? "failed" : "succeeded",
  ...after,
  localCommitCreated,
  ...(uploadedRevision || previous?.uploadedRevision
    ? { uploadedRevision: uploadedRevision ?? previous?.uploadedRevision }
    : {}),
  ...(error ? { error: sanitizeGitSyncError(error) } : {}),
  failureCount: error ? (previous?.failureCount ?? 0) + 1 : 0,
  ...(uploadedRevision
    ? { lastUploadedAt: Date.now() }
    : previous?.lastUploadedAt
      ? { lastUploadedAt: previous.lastUploadedAt }
      : {}),
});
