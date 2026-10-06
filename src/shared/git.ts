import type { WorkspaceFileVersion } from "./file-item";

export const GIT_FILE_STATUS_KINDS = {
  ADDED: "added",
  DELETED: "deleted",
  MODIFIED: "modified",
  RENAMED: "renamed",
  UNTRACKED: "untracked",
  CONFLICTED: "conflicted",
} as const;

export type GitFileStatusKind = (typeof GIT_FILE_STATUS_KINDS)[keyof typeof GIT_FILE_STATUS_KINDS];

export interface GitFileChange {
  conflict?: {
    localExists: boolean;
    remoteExists: boolean;
  };
  conflicted: boolean;
  kind: GitFileStatusKind;
  originalPath?: string;
  path: string;
  staged: boolean;
  workingTreeChanged: boolean;
}

/**
 * Application-owned workspace files stay in Git, but Source Control presents
 * them as one configuration item instead of exposing implementation details.
 */
export const isApplicationGitPath = (filePath: string) =>
  filePath === ".obim" || filePath.startsWith(".obim/") || filePath === ".todo/taskboard.json";

/** New and untracked files have no committed contents that can be restored. */
export const isGitChangeRevertible = (change: GitFileChange) =>
  !change.conflicted &&
  (Boolean(change.originalPath) ||
    (change.kind !== GIT_FILE_STATUS_KINDS.ADDED && change.kind !== GIT_FILE_STATUS_KINDS.UNTRACKED));

export interface GitFileStatusChangeEvent {
  autoSyncSettingsChanged?: boolean;
  /** True when an add, delete, or rename may require rebuilding the Explorer tree. */
  treeMayHaveChanged: boolean;
  /** Workspace-relative paths associated with a possible tree-shape change. */
  paths?: string[];
  /** True only when repository history (HEAD/refs) may have changed. */
  historyMayHaveChanged?: boolean;
}

export type GitFileStatusSnapshot =
  | {
      status: "ready";
      branch?: string;
      changes: GitFileChange[];
      mergeInProgress?: boolean;
      remoteReconciliationInProgress?: boolean;
      repositoryScope: "workspace" | "ancestor";
    }
  | { status: "not-repository"; changes: [] }
  | { status: "unavailable"; changes: []; error: string };

export type GitReadyFileStatusSnapshot = Extract<GitFileStatusSnapshot, { status: "ready" }>;

export type GitRepositoryInitializationResult =
  { status: "succeeded"; snapshot: GitReadyFileStatusSnapshot } | { status: "failed"; error: string };

export type GitOperationResult =
  { status: "succeeded"; snapshot: GitReadyFileStatusSnapshot } | { status: "failed"; error: string };

export interface GitRemoteDetails {
  fetchUrl: string;
  name: "origin";
  pushUrl?: string;
}

export type GitRemoteConfiguration =
  | {
      status: "ready";
      remote?: GitRemoteDetails;
      repositoryScope: "workspace" | "ancestor";
    }
  | { status: "not-repository" }
  | { status: "unavailable"; error: string };

export type GitReadyRemoteConfiguration = Extract<GitRemoteConfiguration, { status: "ready" }>;

export type GitRemoteOperationResult =
  { status: "succeeded"; configuration: GitReadyRemoteConfiguration } | { status: "failed"; error: string };

export type GitRemoteSyncState =
  "no-local-commits" | "unpublished" | "up-to-date" | "ahead" | "behind" | "diverged" | "branch-missing";

export interface GitReadyRemoteSyncStatus {
  status: "ready";
  ahead: number;
  behind: number;
  branch: string;
  remote: GitRemoteDetails;
  state: GitRemoteSyncState;
}

export type GitRemoteSyncStatus =
  GitReadyRemoteSyncStatus | { status: "not-configured" } | { status: "unavailable"; error: string };

export interface GitRemoteChangedPath {
  kind: "added" | "deleted" | "modified";
  path: string;
}

export type GitRemoteSyncOperationResult =
  | {
      status: "succeeded";
      localCommitCreated?: boolean;
      uploadedRevision?: string;
      action: "fetched" | "pulled" | "pushed" | "reconciliation-started" | "up-to-date";
      changedPaths?: GitRemoteChangedPath[];
      snapshot: GitReadyFileStatusSnapshot;
      sync: GitReadyRemoteSyncStatus;
    }
  | { status: "failed"; error: string; uploadedRevision?: string; localCommitCreated?: boolean };

export type GitConflictResolution = "keep-local" | "save-both" | "use-remote";

export interface GitIgnoreSettings {
  patterns: string;
}

export type GitIgnoreSettingsResult =
  { status: "ready"; settings: GitIgnoreSettings } | { status: "failed"; error: string };

export type GitIgnoreUpdateResult =
  | { status: "succeeded"; settings: GitIgnoreSettings; snapshot: GitReadyFileStatusSnapshot; untrackedPaths: string[] }
  | { status: "failed"; error: string };

export interface GitSyncOutcome {
  workspacePath: string;
  source: "scheduled" | "manual";
  phase: "running" | "failed" | "succeeded";
  startedAt: number;
  finishedAt?: number;
  lastUploadedAt?: number;
  localRevision?: string;
  uploadedRevision?: string;
  localCommitCreated: boolean;
  uncommittedChanges: boolean;
  failureCount: number;
  error?: string;
}

export type GitAutoSyncAction = "pulled" | "pushed" | "reconciled" | "up-to-date";

export type GitAutoSyncResult =
  | {
      status: "succeeded";
      localCommitCreated?: boolean;
      uploadedRevision?: string;
      action: GitAutoSyncAction;
      changedPaths?: GitRemoteChangedPath[];
      snapshot: GitReadyFileStatusSnapshot;
      sync: GitReadyRemoteSyncStatus;
    }
  | { status: "failed"; error: string; uploadedRevision?: string; localCommitCreated?: boolean };

export interface GitConflictResolutionRequest {
  path: string;
  resolution: GitConflictResolution;
}

export interface GitConflictPreviewRequest {
  path: string;
}

export type GitConflictVersionPreview =
  | { status: "ready"; content: string; sizeBytes: number }
  | { status: "binary"; sizeBytes: number }
  | { status: "deleted" }
  | { status: "too-large"; sizeBytes: number };

export type GitConflictPreviewResult =
  | {
      status: "ready";
      base: GitConflictVersionPreview;
      local: GitConflictVersionPreview;
      remote: GitConflictVersionPreview;
    }
  | { status: "failed"; error: string };

export type GitConflictOperationResult =
  | {
      status: "succeeded";
      changedPaths: GitRemoteChangedPath[];
      recoveryPaths?: string[];
      savedBothPath?: string;
      snapshot: GitReadyFileStatusSnapshot;
    }
  | { status: "failed"; error: string };

export const GIT_FILE_HISTORY_PAGE_SIZE = 50;

export type GitFileHistoryChangeKind = "added" | "deleted" | "modified" | "renamed";

export interface GitFileHistoryEntry {
  author?: string;
  changeKind: GitFileHistoryChangeKind;
  committedAt: number;
  pathAtRevision: string;
  previousPath?: string;
  revisionId: string;
  /** Opaque capability binding this target file, historical path, and revision. */
  restoreToken: string;
  subject: string;
}

export type GitFileHistoryPage =
  | {
      status: "ready";
      entries: GitFileHistoryEntry[];
      nextCursor?: string;
      repositoryScope: "workspace" | "ancestor";
    }
  | {
      status: "no-history";
      entries: [];
      repositoryScope: "workspace" | "ancestor";
    }
  | { status: "not-repository"; entries: [] }
  | { status: "unavailable"; entries: []; error: string };

export interface GitFileRevisionRequest {
  filePath: string;
  pathAtRevision: string;
  revisionId: string;
  restoreToken: string;
}

export type GitFileRevisionResult =
  | {
      status: "ready";
      content: string;
      revisionId: string;
      sizeBytes: number;
    }
  | { status: "binary"; revisionId: string; sizeBytes: number }
  | { status: "deleted"; revisionId: string }
  | { status: "too-large"; revisionId: string; sizeBytes: number }
  | { status: "failed"; error: string };

export interface GitFileRestoreRequest extends GitFileRevisionRequest {
  expectedVersion?: WorkspaceFileVersion;
}

export type GitFileRestoreResult =
  | {
      status: "succeeded";
      content?: string;
      created: boolean;
      recoveryPath?: string;
      version: WorkspaceFileVersion;
    }
  | { status: "failed"; error: string; errorCode?: "conflict" };
