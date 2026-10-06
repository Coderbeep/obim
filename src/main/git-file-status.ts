import { GitExecutionPolicyError, GitProcessError, runGit } from "./git-command";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { workspaceFileVersionsEqual, type WorkspaceFileVersion } from "@shared/file-item";
import {
  GIT_FILE_STATUS_KINDS,
  isGitChangeRevertible,
  type GitFileChange,
  type GitConflictOperationResult,
  type GitConflictPreviewResult,
  type GitConflictResolution,
  type GitAutoSyncResult,
  type GitFileStatusKind,
  type GitFileStatusSnapshot,
  type GitOperationResult,
  type GitRemoteConfiguration,
  type GitRemoteChangedPath,
  type GitRemoteOperationResult,
  type GitRemoteSyncOperationResult,
  type GitRemoteSyncStatus,
  type GitIgnoreSettingsResult,
  type GitIgnoreUpdateResult,
  type GitReadyFileStatusSnapshot,
  type GitRepositoryInitializationResult,
} from "@shared/git";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "@shared/large-files";
import { resolveWorkspacePath } from "./workspace-paths";
import { toWorkspaceFileVersion } from "./workspace-files";

const GIT_NETWORK_TIMEOUT_MS = 45_000;
const GIT_CONFLICT_BLOB_LIMIT_BYTES = 50 * 1024 * 1024;
const OBIM_RECONCILIATION_STATE_FILE = "OBIM_RECONCILIATION_STATE";
const OBIM_RECONCILIATION_BASELINE_PREFIX = "OBIM_RECONCILIATION_BASELINE.";
const OBIM_GITIGNORE_START = "# Obim managed ignores — edit in Settings";
const OBIM_GITIGNORE_END = "# End Obim managed ignores";
const MAX_GITIGNORE_SETTINGS_BYTES = 64 * 1024;

const trimFinalLineEnding = (value: Buffer) => value.toString("utf8").replace(/\r?\n$/u, "");

const normalizeManagedIgnorePatterns = (value: unknown) => {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_GITIGNORE_SETTINGS_BYTES) return null;
  const lines = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.some((line) => line.includes("\0") || line === OBIM_GITIGNORE_START || line === OBIM_GITIGNORE_END)) {
    return null;
  }
  while (lines.at(-1) === "") lines.pop();
  return lines.join("\n");
};

const splitManagedGitIgnore = (content: string) => {
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const start = normalized.indexOf(OBIM_GITIGNORE_START);
  if (start < 0) return { patterns: "", unmanaged: normalized.replace(/\n+$/u, "") };
  const end = normalized.indexOf(OBIM_GITIGNORE_END, start + OBIM_GITIGNORE_START.length);
  if (end < 0) return null;
  const before = normalized.slice(0, start).replace(/\n+$/u, "");
  const after = normalized.slice(end + OBIM_GITIGNORE_END.length).replace(/^\n+|\n+$/gu, "");
  const patterns = normalized.slice(start + OBIM_GITIGNORE_START.length, end).replace(/^\n|\n$/gu, "");
  return { patterns, unmanaged: [before, after].filter(Boolean).join("\n") };
};

const gitErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof GitProcessError)) return fallback;
  const message = error.message.trim();
  return message ? message.split(/\r?\n/u)[0] : fallback;
};

const CONFLICT_STATUS_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const isConflictStatus = (indexStatus: string, worktreeStatus: string) =>
  indexStatus === "U" || worktreeStatus === "U" || CONFLICT_STATUS_PAIRS.has(`${indexStatus}${worktreeStatus}`);

const classifyStatus = (indexStatus: string, worktreeStatus: string): GitFileStatusKind => {
  if (isConflictStatus(indexStatus, worktreeStatus)) return GIT_FILE_STATUS_KINDS.CONFLICTED;
  if (indexStatus === "?" && worktreeStatus === "?") return GIT_FILE_STATUS_KINDS.UNTRACKED;
  if (indexStatus === "R" || worktreeStatus === "R" || indexStatus === "C" || worktreeStatus === "C") {
    return GIT_FILE_STATUS_KINDS.RENAMED;
  }
  if (indexStatus === "D" || worktreeStatus === "D") return GIT_FILE_STATUS_KINDS.DELETED;
  if (indexStatus === "A" || worktreeStatus === "A") return GIT_FILE_STATUS_KINDS.ADDED;
  return GIT_FILE_STATUS_KINDS.MODIFIED;
};

/** Parses Git's stable, NUL-delimited porcelain v1 status format. */
export const parseGitFileStatus = (output: Buffer): GitFileChange[] => {
  const records = output.toString("utf8").split("\0");
  const changes: GitFileChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4 || record[2] !== " ") continue;

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);
    const renamed = [indexStatus, worktreeStatus].some((status) => status === "R" || status === "C");
    const originalPath = renamed ? records[++index] : undefined;
    const conflicted = isConflictStatus(indexStatus, worktreeStatus);

    changes.push({
      conflicted,
      kind: classifyStatus(indexStatus, worktreeStatus),
      ...(originalPath ? { originalPath } : {}),
      path,
      staged: !conflicted && indexStatus !== " " && indexStatus !== "?",
      workingTreeChanged: conflicted || worktreeStatus !== " " || indexStatus === "?",
    });
  }

  return changes;
};

type ConflictStage = { mode: string; objectId: string; stage: 1 | 2 | 3 };

const parseConflictStages = (output: Buffer) => {
  const stages = new Map<string, ConflictStage[]>();
  for (const record of output.toString("utf8").split("\0")) {
    if (!record) continue;
    const match = /^(\d{6}) ([0-9a-f]+) ([123])\t([\s\S]+)$/u.exec(record);
    if (!match) throw new Error("Git returned an invalid conflict index.");
    const fileStages = stages.get(match[4]) ?? [];
    fileStages.push({ mode: match[1], objectId: match[2], stage: Number(match[3]) as 1 | 2 | 3 });
    stages.set(match[4], fileStages);
  }
  return stages;
};

interface GitReconciliationState {
  baselineDirectory?: string;
  localFiles?: Record<string, { contentFile: string; mode: number } | null>;
  cancelling?: boolean;
  recoveryPaths?: string[];
  branch: string;
  localHead: string;
  remoteHead: string;
  worktreeVersions: Record<string, WorkspaceFileVersion | null>;
}

const reconciliationStatePath = (gitDirectory: string) => path.join(gitDirectory, OBIM_RECONCILIATION_STATE_FILE);

const readGitReconciliationState = async (gitDirectory: string): Promise<GitReconciliationState | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(reconciliationStatePath(gitDirectory), "utf8")) as Record<string, unknown>;
    const validRevision = (value: unknown): value is string =>
      typeof value === "string" && /^[0-9a-f]{40,64}$/u.test(value);
    const validVersion = (value: unknown): value is WorkspaceFileVersion | null => {
      if (value === null) return true;
      if (!value || typeof value !== "object") return false;
      const version = value as Partial<WorkspaceFileVersion>;
      return (
        (version.id === undefined || typeof version.id === "string") &&
        typeof version.mtimeMs === "number" &&
        Number.isFinite(version.mtimeMs) &&
        typeof version.sizeBytes === "number" &&
        Number.isSafeInteger(version.sizeBytes) &&
        version.sizeBytes >= 0
      );
    };
    const validVersions =
      parsed.worktreeVersions &&
      typeof parsed.worktreeVersions === "object" &&
      !Array.isArray(parsed.worktreeVersions) &&
      Object.entries(parsed.worktreeVersions).every(
        ([filePath, version]) => Boolean(filePath) && !filePath.includes("\0") && validVersion(version),
      );
    if (
      typeof parsed.branch !== "string" ||
      !parsed.branch ||
      !validRevision(parsed.localHead) ||
      !validRevision(parsed.remoteHead) ||
      !validVersions
    ) {
      return undefined;
    }
    const localFiles = parsed.localFiles;
    const baselineDirectory = parsed.baselineDirectory;
    if (localFiles !== undefined || baselineDirectory !== undefined) {
      if (
        typeof baselineDirectory !== "string" ||
        !/^OBIM_RECONCILIATION_BASELINE\.[0-9a-f-]{36}$/u.test(baselineDirectory) ||
        !localFiles ||
        typeof localFiles !== "object" ||
        Array.isArray(localFiles) ||
        !Object.entries(localFiles).every(
          ([filePath, value]) =>
            filePath &&
            (value === null ||
              (typeof value === "object" &&
                value &&
                /^[0-9a-f-]{36}$/u.test(value.contentFile) &&
                Number.isInteger(value.mode) &&
                value.mode >= 0 &&
                value.mode <= 0o777)),
        )
      )
        return undefined;
    }
    return {
      ...(localFiles
        ? {
            baselineDirectory: baselineDirectory as string,
            localFiles: localFiles as GitReconciliationState["localFiles"],
          }
        : {}),
      ...(parsed.cancelling === true ? { cancelling: true } : {}),
      ...(Array.isArray(parsed.recoveryPaths) && parsed.recoveryPaths.every((value) => typeof value === "string")
        ? { recoveryPaths: parsed.recoveryPaths as string[] }
        : {}),
      branch: parsed.branch,
      localHead: parsed.localHead,
      remoteHead: parsed.remoteHead,
      worktreeVersions: parsed.worktreeVersions as Record<string, WorkspaceFileVersion | null>,
    };
  } catch {
    return undefined;
  }
};

const writeGitReconciliationState = async (gitDirectory: string, state: GitReconciliationState) => {
  const temporaryPath = path.join(gitDirectory, `${OBIM_RECONCILIATION_STATE_FILE}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify(state)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, reconciliationStatePath(gitDirectory));
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const removeGitReconciliationState = async (gitDirectory?: string) => {
  if (!gitDirectory) return;
  const state = await readGitReconciliationState(gitDirectory);
  if (state?.baselineDirectory)
    await rm(path.join(gitDirectory, state.baselineDirectory), { recursive: true, force: true });
  await rm(reconciliationStatePath(gitDirectory), { force: true });
};

const captureReconciliationBaseline = async (workspacePath: string, gitDirectory: string, paths: string[]) => {
  const baselineDirectory = `${OBIM_RECONCILIATION_BASELINE_PREFIX}${randomUUID()}`;
  const directoryPath = path.join(gitDirectory, baselineDirectory);
  const localFiles: NonNullable<GitReconciliationState["localFiles"]> = {};
  await mkdir(directoryPath, { mode: 0o700 });
  try {
    for (const relativePath of new Set(paths)) {
      const file = await readRegularWorktreeFile(resolveWorkspacePath(workspacePath, relativePath));
      if (!file) {
        localFiles[relativePath] = null;
        continue;
      }
      const contentFile = randomUUID();
      const snapshot = await open(path.join(directoryPath, contentFile), "wx", 0o600);
      try {
        await snapshot.writeFile(file.content);
        await snapshot.sync();
      } finally {
        await snapshot.close();
      }
      localFiles[relativePath] = { contentFile, mode: file.mode };
    }
    return { baselineDirectory, localFiles };
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    throw error;
  }
};

const readWorktreeVersion = async (
  workspacePath: string,
  relativePath: string,
): Promise<WorkspaceFileVersion | null> => {
  try {
    return toWorkspaceFileVersion(await lstat(resolveWorkspacePath(workspacePath, relativePath)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
};

const worktreeVersionsEqual = (left: WorkspaceFileVersion | null, right: WorkspaceFileVersion | null) =>
  left === null || right === null ? left === right : workspaceFileVersionsEqual(left, right);

const readWorktreeVersions = async (workspacePath: string, relativePaths: readonly string[]) =>
  Object.fromEntries(
    await Promise.all(
      [...new Set(relativePaths)].map(async (relativePath) => [
        relativePath,
        await readWorktreeVersion(workspacePath, relativePath),
      ]),
    ),
  ) as Record<string, WorkspaceFileVersion | null>;

const changedTrackedReconciliationPaths = async (workspacePath: string, state: GitReconciliationState) => {
  const paths = Object.keys(state.worktreeVersions);
  const current = await readWorktreeVersions(workspacePath, paths);
  return paths.filter(
    (relativePath) =>
      !worktreeVersionsEqual(state.worktreeVersions[relativePath] ?? null, current[relativePath] ?? null),
  );
};

const executableReconciliationConfigError = async (workspacePath: string) => {
  try {
    const configured = await runGit(
      workspacePath,
      ["config", "--includes", "--get-regexp", "^(merge\\..*\\.driver|filter\\..*\\.(clean|smudge|process))$"],
      { isolateUserConfig: true },
    );
    if (configured.length > 0) {
      return "This repository configures executable Git merge or file-conversion commands. Obim will not run them; remove that local Git configuration or complete this operation outside Obim.";
    }
  } catch (error) {
    if (error instanceof GitProcessError && error.exitCode === 1) return undefined;
    throw error;
  }
  return undefined;
};

const toGitPath = (value: string) => value.split(path.sep).join("/");

const relativeToScope = (gitPath: string, scopePrefix: string) => {
  if (!scopePrefix) return gitPath;
  if (gitPath === scopePrefix) return "";
  return gitPath.startsWith(`${scopePrefix}/`) ? gitPath.slice(scopePrefix.length + 1) : null;
};

const scopeChanges = (changes: GitFileChange[], scopePrefix: string): GitFileChange[] =>
  changes.flatMap((change) => {
    const scopedPath = relativeToScope(change.path, scopePrefix);
    const scopedOriginalPath = change.originalPath ? relativeToScope(change.originalPath, scopePrefix) : null;
    const changeWithoutOriginalPath = { ...change };
    delete changeWithoutOriginalPath.originalPath;

    if (scopedPath !== null) {
      return [
        {
          ...changeWithoutOriginalPath,
          ...(scopedOriginalPath ? { originalPath: scopedOriginalPath } : {}),
          path: scopedPath,
        },
      ];
    }
    if (scopedOriginalPath !== null) {
      return [
        {
          ...changeWithoutOriginalPath,
          conflicted: false,
          kind: GIT_FILE_STATUS_KINDS.DELETED,
          path: scopedOriginalPath,
          staged: true,
          workingTreeChanged: false,
        },
      ];
    }
    return [];
  });

const notRepositoryError = (error: GitProcessError) =>
  error.exitCode === 128 && error.message.toLowerCase().includes("not a git repository");

type MutableWorkspaceRepositoryLocationResult = { gitDirectory: string } | { error: string };

const getMutableWorkspaceRepositoryLocation = async (
  workspacePath: string,
): Promise<MutableWorkspaceRepositoryLocationResult> => {
  try {
    const [repositoryRoot, gitDirectory, insideWorkTree] = await Promise.all([
      runGit(workspacePath, ["rev-parse", "--show-toplevel"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", "--absolute-git-dir"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", "--is-inside-work-tree"]).then(trimFinalLineEnding),
    ]);
    if (insideWorkTree !== "true") return { error: "This Git repository has no working tree." };

    const [canonicalRepositoryRoot, canonicalWorkspacePath] = await Promise.all([
      realpath(repositoryRoot),
      realpath(workspacePath),
    ]);
    if (canonicalRepositoryRoot !== canonicalWorkspacePath) {
      return { error: "Source Control actions are disabled because this workspace is inside a parent repository." };
    }
    return { gitDirectory };
  } catch (error) {
    if (error instanceof GitProcessError && notRepositoryError(error)) return { error: "Initialize Git first." };
    if (error instanceof GitProcessError && error.processCode === "ENOENT") {
      return { error: "Git is not installed or cannot be found." };
    }
    return { error: "Git status is unavailable for this workspace." };
  }
};

export interface GitFileStatusReadResult {
  gitDirectory?: string;
  snapshot: GitFileStatusSnapshot;
}

export const readGitFileStatus = async (workspacePath: string): Promise<GitFileStatusReadResult> => {
  try {
    const repositoryRoot = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "--show-toplevel"]));
    const gitDirectory = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "--absolute-git-dir"]));
    const insideWorkTree = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "--is-inside-work-tree"]));
    if (insideWorkTree !== "true") {
      return { snapshot: { status: "unavailable", changes: [], error: "This Git repository has no working tree." } };
    }

    const [canonicalRepositoryRoot, canonicalWorkspacePath] = await Promise.all([
      realpath(repositoryRoot),
      realpath(workspacePath),
    ]);
    const relativeWorkspace = path.relative(canonicalRepositoryRoot, canonicalWorkspacePath);
    const workspaceIsOutsideRepository =
      relativeWorkspace === ".." || relativeWorkspace.startsWith(`..${path.sep}`) || path.isAbsolute(relativeWorkspace);
    if (workspaceIsOutsideRepository) {
      return {
        snapshot: { status: "unavailable", changes: [], error: "The workspace is outside the detected repository." },
      };
    }

    const scopePrefix = toGitPath(relativeWorkspace);
    let branch: string | undefined;
    let symbolicBranch: string | undefined;
    try {
      symbolicBranch = trimFinalLineEnding(
        await runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
      );
      branch = symbolicBranch;
    } catch {
      try {
        const detachedHead = trimFinalLineEnding(await runGit(repositoryRoot, ["rev-parse", "--short", "HEAD"]));
        branch = detachedHead ? `Detached at ${detachedHead}` : undefined;
      } catch {
        // An unborn repository can have no resolvable HEAD yet.
      }
    }
    const statusArgs = [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=all",
      ...(scopePrefix ? ["--", scopePrefix] : []),
    ];
    const repositoryChanges = parseGitFileStatus(await runGit(repositoryRoot, statusArgs));
    if (repositoryChanges.some((change) => change.conflicted)) {
      const conflictArgs = ["ls-files", "--unmerged", "-z", ...(scopePrefix ? ["--", scopePrefix] : [])];
      const conflictStages = parseConflictStages(await runGit(repositoryRoot, conflictArgs));
      for (const change of repositoryChanges) {
        if (!change.conflicted) continue;
        const stages = conflictStages.get(change.path) ?? [];
        change.conflict = {
          localExists: stages.some((stage) => stage.stage === 2),
          remoteExists: stages.some((stage) => stage.stage === 3),
        };
      }
    }
    const changes = scopeChanges(repositoryChanges, scopePrefix);
    let mergeHeadRevision: string | undefined;
    try {
      mergeHeadRevision = trimFinalLineEnding(await runGit(repositoryRoot, ["rev-parse", "--verify", "MERGE_HEAD"]));
    } catch (error) {
      if (!(error instanceof GitProcessError) || error.exitCode !== 128) throw error;
    }
    let remoteReconciliationInProgress = false;
    if (symbolicBranch) {
      try {
        const [currentHead, reconciliationState] = await Promise.all([
          runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"]).then(trimFinalLineEnding),
          readGitReconciliationState(gitDirectory),
        ]);
        remoteReconciliationInProgress = Boolean(
          reconciliationState &&
          reconciliationState.branch === symbolicBranch &&
          reconciliationState.localHead === currentHead &&
          (reconciliationState.remoteHead === mergeHeadRevision ||
            (!mergeHeadRevision && reconciliationState.cancelling)),
        );
      } catch {
        // A missing or malformed application marker leaves an external merge outside Obim's resolver.
      }
    }
    return {
      gitDirectory,
      snapshot: {
        status: "ready",
        ...(branch ? { branch } : {}),
        changes,
        ...(mergeHeadRevision || remoteReconciliationInProgress ? { mergeInProgress: true } : {}),
        ...(remoteReconciliationInProgress ? { remoteReconciliationInProgress: true } : {}),
        repositoryScope: scopePrefix ? "ancestor" : "workspace",
      },
    };
  } catch (error) {
    if (error instanceof GitProcessError && notRepositoryError(error)) {
      return { snapshot: { status: "not-repository", changes: [] } };
    }
    if (error instanceof GitProcessError && error.processCode === "ENOENT") {
      return {
        snapshot: { status: "unavailable", changes: [], error: "Git is not installed or cannot be found." },
      };
    }
    return {
      snapshot: {
        status: "unavailable",
        changes: [],
        error:
          error instanceof GitExecutionPolicyError ? error.message : "Git status is unavailable for this workspace.",
      },
    };
  }
};

type MutableWorkspaceRepositoryResult =
  { current: GitFileStatusReadResult & { snapshot: GitReadyFileStatusSnapshot } } | { error: string };

const getMutableWorkspaceRepository = async (workspacePath: string): Promise<MutableWorkspaceRepositoryResult> => {
  const current = await readGitFileStatus(workspacePath);
  if (current.snapshot.status !== "ready") {
    return { error: current.snapshot.status === "unavailable" ? current.snapshot.error : "Initialize Git first." };
  }
  if (current.snapshot.repositoryScope !== "workspace") {
    return { error: "Source Control actions are disabled because this workspace is inside a parent repository." };
  }
  return { current: { ...current, snapshot: current.snapshot } };
};

const reconciliationRemoteActionError = "Finish or cancel the current merge before changing or contacting the remote.";

const readOptionalLocalConfig = async (workspacePath: string, key: string) => {
  try {
    return trimFinalLineEnding(await runGit(workspacePath, ["config", "--local", "--get", key]));
  } catch (error) {
    if (error instanceof GitProcessError && error.exitCode === 1) return undefined;
    throw error;
  }
};

const redactRemoteCredentials = (value: string) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
    } else if (parsed.password) {
      parsed.password = "";
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value.replace(/[?#].*$/u, "");
  }
};

export const readGitRemoteConfiguration = async (
  workspacePath: string,
  current?: GitFileStatusReadResult,
): Promise<GitRemoteConfiguration> => {
  const status = current ?? (await readGitFileStatus(workspacePath));
  if (status.snapshot.status === "not-repository") return { status: "not-repository" };
  if (status.snapshot.status === "unavailable") return { status: "unavailable", error: status.snapshot.error };

  try {
    const [fetchUrl, pushUrl] = await Promise.all([
      readOptionalLocalConfig(workspacePath, "remote.origin.url"),
      readOptionalLocalConfig(workspacePath, "remote.origin.pushurl"),
    ]);
    return {
      status: "ready",
      ...(fetchUrl
        ? {
            remote: {
              fetchUrl: redactRemoteCredentials(fetchUrl),
              name: "origin" as const,
              ...(pushUrl && pushUrl !== fetchUrl ? { pushUrl: redactRemoteCredentials(pushUrl) } : {}),
            },
          }
        : {}),
      repositoryScope: status.snapshot.repositoryScope,
    };
  } catch {
    return { status: "unavailable", error: "Git remote configuration could not be read." };
  }
};

const normalizeRemoteUrl = (rawUrl: string): { value: string } | { error: string } => {
  const value = rawUrl.trim();
  if (!value) return { error: "Enter an HTTPS or SSH repository URL." };
  if (value.length > 4_096) return { error: "The remote URL is too long." };
  if (/[\0\r\n\t\s]/u.test(value)) return { error: "The remote URL cannot contain whitespace or control characters." };
  if (value.startsWith("-")) return { error: "The remote URL is invalid." };
  if (/[?#]/u.test(value)) return { error: "The remote URL cannot contain query parameters or fragments." };

  if (/^https:\/\//iu.test(value) || /^ssh:\/\//iu.test(value)) {
    try {
      const parsed = new URL(value);
      if (!parsed.hostname || parsed.pathname.length <= 1) return { error: "Enter a complete repository URL." };
      if (parsed.search || parsed.hash) {
        return { error: "The remote URL cannot contain query parameters or fragments." };
      }
      if (parsed.password || (parsed.protocol === "https:" && parsed.username)) {
        return {
          error: "Do not include credentials in the URL. Use your system Git credential helper or SSH agent.",
        };
      }
      return { value };
    } catch {
      return { error: "Enter a valid HTTPS or SSH repository URL." };
    }
  }

  if (/^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\]):[^:]+$/u.test(value)) return { value };
  return { error: "Only HTTPS and SSH repository URLs are supported." };
};

const hasOriginRemote = async (workspacePath: string) => {
  const remotes = trimFinalLineEnding(await runGit(workspacePath, ["remote"]));
  return remotes.split(/\r?\n/u).includes("origin");
};

const refreshedRemoteOperationResult = async (workspacePath: string): Promise<GitRemoteOperationResult> => {
  const configuration = await readGitRemoteConfiguration(workspacePath);
  return configuration.status === "ready"
    ? { status: "succeeded", configuration }
    : { status: "failed", error: "Git changed the remote, but its updated configuration could not be read." };
};

export const setGitRemoteUrl = async (workspacePath: string, rawUrl: string): Promise<GitRemoteOperationResult> => {
  const normalized = normalizeRemoteUrl(rawUrl);
  if ("error" in normalized) return { status: "failed", error: normalized.error };

  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: reconciliationRemoteActionError };
  }

  try {
    if (await hasOriginRemote(workspacePath)) {
      await runGit(workspacePath, ["config", "--local", "--replace-all", "remote.origin.url", normalized.value]);
    } else {
      await runGit(workspacePath, ["remote", "add", "origin", normalized.value]);
    }
    try {
      await runGit(workspacePath, ["config", "--local", "--unset-all", "remote.origin.pushurl"]);
    } catch (error) {
      if (!(error instanceof GitProcessError) || error.exitCode !== 5) throw error;
    }
    return refreshedRemoteOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not configure the origin remote.") };
  }
};

export const removeGitRemote = async (workspacePath: string): Promise<GitRemoteOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: reconciliationRemoteActionError };
  }

  try {
    if (await hasOriginRemote(workspacePath)) await runGit(workspacePath, ["remote", "remove", "origin"]);
    return refreshedRemoteOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not remove the origin remote.") };
  }
};

const readWorkspaceGitIgnore = async (workspacePath: string) => {
  const gitIgnorePath = path.join(workspacePath, ".gitignore");
  try {
    const info = await lstat(gitIgnorePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("The workspace .gitignore must be a regular file.");
    const content = await readFile(gitIgnorePath, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_GITIGNORE_SETTINGS_BYTES * 4) {
      throw new Error("The workspace .gitignore is too large to edit in Settings.");
    }
    return content;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
};

export const readGitIgnoreSettings = async (workspacePath: string): Promise<GitIgnoreSettingsResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  try {
    const sections = splitManagedGitIgnore(await readWorkspaceGitIgnore(workspacePath));
    if (!sections) {
      return {
        status: "failed",
        error: "The Obim-managed section in .gitignore is incomplete. Repair it manually first.",
      };
    }
    return { status: "ready", settings: { patterns: sections.patterns } };
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git ignore settings could not be read.") };
  }
};

export const updateGitIgnoreSettings = async (
  workspacePath: string,
  rawPatterns: unknown,
): Promise<GitIgnoreUpdateResult> => {
  const patterns = normalizeManagedIgnorePatterns(rawPatterns);
  if (patterns === null) return { status: "failed", error: "Ignore patterns are invalid or too large." };
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: "Finish or cancel the current merge before changing ignored files." };
  }

  const gitIgnorePath = path.join(workspacePath, ".gitignore");
  const temporaryPath = path.join(workspacePath, `.gitignore.obim-${randomUUID()}.tmp`);
  try {
    const sections = splitManagedGitIgnore(await readWorkspaceGitIgnore(workspacePath));
    if (!sections) {
      return {
        status: "failed",
        error: "The Obim-managed section in .gitignore is incomplete. Repair it manually first.",
      };
    }
    const managed = patterns ? `${OBIM_GITIGNORE_START}\n${patterns}\n${OBIM_GITIGNORE_END}` : "";
    const content = [sections.unmanaged, managed].filter(Boolean).join("\n\n");
    await writeFile(temporaryPath, content ? `${content}\n` : "", { encoding: "utf8", flag: "wx", mode: 0o644 });
    await rename(temporaryPath, gitIgnorePath);

    const ignoredTrackedOutput = await runGit(workspacePath, ["ls-files", "-ci", "--exclude-standard", "-z"]);
    const untrackedPaths = ignoredTrackedOutput.toString("utf8").split("\0").filter(Boolean);
    for (let index = 0; index < untrackedPaths.length; index += 100) {
      await runGit(workspacePath, [
        "rm",
        "--cached",
        "--quiet",
        "-f",
        "--ignore-unmatch",
        "--",
        ...untrackedPaths.slice(index, index + 100),
      ]);
    }
    const refreshed = await readGitFileStatus(workspacePath);
    if (refreshed.snapshot.status !== "ready") {
      return { status: "failed", error: "Ignore patterns were saved, but Git status could not be refreshed." };
    }
    return { status: "succeeded", settings: { patterns }, snapshot: refreshed.snapshot, untrackedPaths };
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return { status: "failed", error: gitErrorMessage(error, "Git ignore settings could not be saved.") };
  }
};

type OriginUrls = {
  fetchUrl: string;
  pushUrl: string;
  remote: { fetchUrl: string; name: "origin"; pushUrl?: string };
};

export interface GitRemoteExecutionOptions {
  signal?: AbortSignal;
  runLocal?: <T>(operation: () => Promise<T>) => Promise<T>;
  expectedHead?: string;
  expectedDestination?: string;
  beforeNetworkForTests?: (phase: "fetch" | "push") => Promise<void>;
  /** Keeps local bare-repository tests realistic without weakening the Electron runtime. */
  allowUrlRewriteForTests?: boolean;
}

type RemoteGitTestOptions = GitRemoteExecutionOptions;

const runLocalGitPhase = <T>(
  options: GitRemoteExecutionOptions | undefined,
  operation: () => Promise<T>,
): Promise<T> => {
  const guarded = () => {
    if (options?.signal?.aborted) throw new GitProcessError("Git synchronization was cancelled.");
    return operation();
  };
  return options?.runLocal ? options.runLocal(guarded) : Promise.resolve().then(guarded);
};

const beforeGitNetwork = async (
  workspacePath: string,
  options: GitRemoteExecutionOptions | undefined,
  phase: "fetch" | "push",
) => {
  if (process.env.VITEST === "true") await options?.beforeNetworkForTests?.(phase);
  if (options?.signal?.aborted) throw new GitProcessError("Git synchronization was cancelled.");
  if (options?.expectedDestination) {
    const current = await readGitAutoSyncDestination(workspacePath, options);
    if ("error" in current || current.destination !== options.expectedDestination)
      throw new GitProcessError("The synchronization destination changed. Review the destination before retrying.");
  }
};

const originStillMatches = async (workspacePath: string, origin: OriginUrls, options?: GitRemoteExecutionOptions) => {
  const current = await readOriginUrls(workspacePath, options);
  return !("error" in current) && current.fetchUrl === origin.fetchUrl && current.pushUrl === origin.pushUrl;
};

const readOriginUrls = async (
  workspacePath: string,
  testOptions?: RemoteGitTestOptions,
): Promise<OriginUrls | { error: string }> => {
  const fetchUrl = await readOptionalLocalConfig(workspacePath, "remote.origin.url");
  if (!fetchUrl) return { error: "Connect an origin repository in Settings first." };
  const normalizedFetchUrl = normalizeRemoteUrl(fetchUrl);
  if ("error" in normalizedFetchUrl) {
    return { error: "Origin uses an unsupported or unsafe URL. Update it in Version History settings." };
  }

  const configuredPushUrl = await readOptionalLocalConfig(workspacePath, "remote.origin.pushurl");
  const normalizedPushUrl = configuredPushUrl ? normalizeRemoteUrl(configuredPushUrl) : normalizedFetchUrl;
  if ("error" in normalizedPushUrl) {
    return { error: "Origin uses an unsupported or unsafe push URL. Update it with a Git client before pushing." };
  }

  const allowUrlRewrite = testOptions?.allowUrlRewriteForTests === true && process.env.VITEST === "true";
  if (!allowUrlRewrite) {
    const [effectiveFetchUrl, effectivePushUrl] = await Promise.all([
      runGit(workspacePath, ["remote", "get-url", "origin"]),
      runGit(workspacePath, ["remote", "get-url", "--push", "origin"]),
    ]).then((values) => values.map(trimFinalLineEnding));
    if (effectiveFetchUrl !== normalizedFetchUrl.value || effectivePushUrl !== normalizedPushUrl.value) {
      return {
        error:
          "Git configuration redirects this origin to a different location. Obim will not use hidden URL rewrites; enter the final HTTPS or SSH URL instead.",
      };
    }
  }

  return {
    fetchUrl: normalizedFetchUrl.value,
    pushUrl: normalizedPushUrl.value,
    remote: {
      fetchUrl: redactRemoteCredentials(normalizedFetchUrl.value),
      name: "origin",
      ...(configuredPushUrl && normalizedPushUrl.value !== normalizedFetchUrl.value
        ? { pushUrl: redactRemoteCredentials(normalizedPushUrl.value) }
        : {}),
    },
  };
};

export const readGitSyncLocalState = async (workspacePath: string) => {
  let localRevision: string | undefined;
  try {
    localRevision = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "--verify", "HEAD"]));
  } catch {
    /* An unborn repository has no local revision. */
  }
  const status = await readGitFileStatus(workspacePath);
  return {
    ...(localRevision ? { localRevision } : {}),
    uncommittedChanges: status.snapshot.status !== "ready" || status.snapshot.changes.length > 0,
  };
};

/** Validates the workspace/destination without committing or contacting the remote. */
export const readGitAutoSyncDestination = async (
  workspacePath: string,
  testOptions?: RemoteGitTestOptions,
): Promise<{ destination: string } | { error: string }> => {
  try {
    const repository = await getMutableWorkspaceRepository(workspacePath);
    if ("error" in repository) return repository;
    const origin = await readOriginUrls(workspacePath, testOptions);
    if ("error" in origin) return origin;
    const branch = trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]));
    return {
      destination: createHash("sha256")
        .update(JSON.stringify([origin.fetchUrl, origin.pushUrl, branch]))
        .digest("hex"),
    };
  } catch (error) {
    return { error: gitErrorMessage(error, "The automatic synchronization destination could not be validated.") };
  }
};

const refExists = async (workspacePath: string, ref: string) => {
  try {
    await runGit(workspacePath, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch (error) {
    if (error instanceof GitProcessError && error.exitCode === 1) return false;
    throw error;
  }
};

const readRemoteBranches = async (workspacePath: string) => {
  const output = trimFinalLineEnding(
    await runGit(workspacePath, ["for-each-ref", "--format=%(refname)", "refs/remotes/origin"]),
  );
  return output
    .split(/\r?\n/u)
    .filter((ref) => ref.startsWith("refs/remotes/origin/") && ref !== "refs/remotes/origin/HEAD");
};

const readGitRemoteSyncStatusFromOrigin = async (
  workspacePath: string,
  origin: OriginUrls,
): Promise<GitRemoteSyncStatus> => {
  try {
    let branch: string;
    try {
      branch = trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]));
    } catch {
      return {
        status: "unavailable",
        error: "Remote actions are unavailable while the repository is in detached HEAD state.",
      };
    }

    let hasLocalCommit = true;
    try {
      await runGit(workspacePath, ["rev-parse", "--verify", "HEAD"]);
    } catch {
      hasLocalCommit = false;
    }
    if (!hasLocalCommit) {
      return { status: "ready", ahead: 0, behind: 0, branch, remote: origin.remote, state: "no-local-commits" };
    }

    const remoteRef = `refs/remotes/origin/${branch}`;
    if (!(await refExists(workspacePath, remoteRef))) {
      const remoteBranches = await readRemoteBranches(workspacePath);
      return {
        status: "ready",
        ahead: 0,
        behind: 0,
        branch,
        remote: origin.remote,
        state: remoteBranches.length === 0 ? "unpublished" : "branch-missing",
      };
    }

    const counts = trimFinalLineEnding(
      await runGit(workspacePath, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]),
    )
      .trim()
      .split(/\s+/u)
      .map(Number);
    const ahead = counts[0];
    const behind = counts[1];
    if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind) || ahead < 0 || behind < 0) {
      return { status: "unavailable", error: "Git returned an invalid remote comparison." };
    }
    const state = ahead > 0 && behind > 0 ? "diverged" : ahead > 0 ? "ahead" : behind > 0 ? "behind" : "up-to-date";
    return { status: "ready", ahead, behind, branch, remote: origin.remote, state };
  } catch (error) {
    return {
      status: "unavailable",
      error: gitErrorMessage(error, "Remote status is unavailable."),
    };
  }
};

export const readGitRemoteSyncStatus = async (
  workspacePath: string,
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncStatus> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "unavailable", error: repository.error };

  try {
    const origin = await readOriginUrls(workspacePath, testOptions);
    if ("error" in origin) {
      return origin.error.startsWith("Connect an origin")
        ? { status: "not-configured" }
        : { status: "unavailable", error: origin.error };
    }
    return readGitRemoteSyncStatusFromOrigin(workspacePath, origin);
  } catch (error) {
    return {
      status: "unavailable",
      error: gitErrorMessage(error, "Remote status is unavailable."),
    };
  }
};

const networkErrorMessage = (error: unknown, action: "checking" | "pulling" | "pushing") => {
  if (!(error instanceof GitProcessError)) return `Git failed while ${action} the remote repository.`;
  const raw = error.message.trim();
  const lower = raw.toLowerCase();
  if (lower.includes("timed out")) {
    return "The remote connection timed out. Check your network and try again.";
  }
  if (
    lower.includes("authentication failed") ||
    lower.includes("could not read username") ||
    lower.includes("permission denied (publickey)") ||
    lower.includes("authentication required")
  ) {
    return "Authentication failed. For HTTPS, configure a system Git credential helper; for SSH, load a permitted key into your SSH agent.";
  }
  if (lower.includes("host key verification failed")) {
    return "SSH host verification failed. Verify the host once in a terminal, then try again.";
  }
  if (
    lower.includes("repository not found") ||
    lower.includes("does not appear to be a git repository") ||
    lower.includes("couldn't find remote ref")
  ) {
    return "The remote repository was not found or access was denied. Check the URL and repository permissions.";
  }
  if (
    lower.includes("could not resolve host") ||
    lower.includes("failed to connect") ||
    lower.includes("network is unreachable") ||
    lower.includes("connection refused")
  ) {
    return "The remote host could not be reached. Check your network, URL, VPN, or firewall.";
  }
  if (lower.includes("non-fast-forward") || lower.includes("fetch first") || lower.includes("rejected")) {
    return "The remote has newer commits, so Obim refused to overwrite it. Check the remote and pull its changes first.";
  }
  const detail = raw.split(/\r?\n/u).filter(Boolean).slice(0, 3).join(" ").slice(0, 600);
  return detail || `Git failed while ${action} the remote repository.`;
};

const fetchOriginRefs = async (
  workspacePath: string,
  origin: OriginUrls,
  hooksDirectory?: string,
  options?: GitRemoteExecutionOptions,
) => {
  await beforeGitNetwork(workspacePath, options, "fetch");
  if (!(await originStillMatches(workspacePath, origin, options)))
    throw new GitProcessError("The remote destination changed before the network operation began.");
  if (options?.expectedHead && (await readGitSyncLocalState(workspacePath)).localRevision !== options.expectedHead)
    throw new GitProcessError("The local history changed before the network operation began.");
  await runGit(
    workspacePath,
    [
      ...(hooksDirectory ? ["-c", `core.hooksPath=${hooksDirectory}`] : []),
      "fetch",
      "--quiet",
      "--prune",
      "--no-tags",
      "--no-recurse-submodules",
      origin.fetchUrl,
      "+refs/heads/*:refs/remotes/origin/*",
    ],
    { timeoutMs: GIT_NETWORK_TIMEOUT_MS, signal: options?.signal },
  );
};

const successfulRemoteSyncResult = async (
  workspacePath: string,
  action: "fetched" | "pulled" | "pushed" | "reconciliation-started" | "up-to-date",
  changedPaths?: GitRemoteChangedPath[],
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncOperationResult> => {
  const [current, sync] = await Promise.all([
    readGitFileStatus(workspacePath),
    readGitRemoteSyncStatus(workspacePath, testOptions),
  ]);
  if (current.snapshot.status !== "ready" || sync.status !== "ready") {
    return { status: "failed", error: "The remote action completed, but its updated state could not be read." };
  }
  let uploadedRevision: string | undefined;
  if (sync.state === "up-to-date") {
    const [localHead, remoteHead] = await Promise.all([
      runGit(workspacePath, ["rev-parse", "HEAD"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", `refs/remotes/origin/${sync.branch}`]).then(trimFinalLineEnding),
    ]);
    if (localHead === remoteHead) uploadedRevision = localHead;
  }
  return {
    ...(uploadedRevision ? { uploadedRevision } : {}),
    status: "succeeded",
    action,
    ...(changedPaths?.length ? { changedPaths } : {}),
    snapshot: current.snapshot,
    sync,
  };
};

export const fetchGitRemote = async (
  workspacePath: string,
  hooksDirectory?: string,
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: reconciliationRemoteActionError };
  }
  const origin = await readOriginUrls(workspacePath, testOptions);
  if ("error" in origin) return { status: "failed", error: origin.error };

  try {
    await fetchOriginRefs(workspacePath, origin, hooksDirectory, testOptions);
    return successfulRemoteSyncResult(workspacePath, "fetched", undefined, testOptions);
  } catch (error) {
    return { status: "failed", error: networkErrorMessage(error, "checking") };
  }
};

type IncomingRemoteChange = GitRemoteChangedPath & { newMode: string };

const readIncomingRemoteChanges = async (workspacePath: string, fromRevision: string, toRevision: string) => {
  const records = (await runGit(workspacePath, ["diff", "--raw", "-z", "--no-renames", fromRevision, toRevision, "--"]))
    .toString("utf8")
    .split("\0");
  const changes: IncomingRemoteChange[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const header = records[index];
    if (!header) continue;
    const match = /^:\d{6} (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])$/u.exec(header);
    const changedPath = records[++index];
    if (!match || !changedPath) throw new Error("Git returned an invalid incoming change list.");
    const status = match[2];
    changes.push({
      kind: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
      newMode: match[1],
      path: changedPath,
    });
  }
  return changes;
};

const pathExists = async (targetPath: string) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const hasSymlinkAncestor = async (workspacePath: string, relativePath: string) => {
  const segments = relativePath.split("/").slice(0, -1);
  let current = workspacePath;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return false;
};

const validateIncomingRemoteChanges = async (workspacePath: string, changes: IncomingRemoteChange[]) => {
  for (const change of changes) {
    if (change.path === ".gitmodules" || change.newMode === "120000" || change.newMode === "160000") {
      return "The remote update contains symlinks or submodules. Obim will not apply those potentially unsafe entries.";
    }
    if (await hasSymlinkAncestor(workspacePath, change.path)) {
      return `The remote update would write through a symbolic-link directory (${change.path}). Obim did not apply it.`;
    }
    if (change.kind === "added" && (await pathExists(path.join(workspacePath, ...change.path.split("/"))))) {
      return `The remote update would overwrite an existing untracked or ignored path (${change.path}). Obim did not apply it.`;
    }
  }
  return undefined;
};

export const pullGitRemote = async (
  workspacePath: string,
  hooksDirectory?: string,
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncOperationResult> => {
  let repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: reconciliationRemoteActionError };
  }
  if (repository.current.snapshot.changes.length > 0) {
    return { status: "failed", error: "Commit, revert, or remove all local changes before pulling from the remote." };
  }
  const origin = await readOriginUrls(workspacePath, testOptions);
  if ("error" in origin) return { status: "failed", error: origin.error };

  try {
    const capturedHead = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "HEAD"]));
    const capturedBranch = trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "HEAD"]));
    await fetchOriginRefs(workspacePath, origin, hooksDirectory, testOptions);
    return await runLocalGitPhase(testOptions, async () => {
      if (
        !(await originStillMatches(workspacePath, origin, testOptions)) ||
        trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "HEAD"])) !== capturedHead ||
        trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "HEAD"])) !== capturedBranch
      ) {
        return {
          status: "failed",
          error: "The local history or destination changed while checking the remote. Nothing was pulled.",
        };
      }
      repository = await getMutableWorkspaceRepository(workspacePath);
      if ("error" in repository) return { status: "failed", error: repository.error };
      if (repository.current.snapshot.changes.length > 0) {
        return { status: "failed", error: "Local files changed while checking the remote. Nothing was pulled." };
      }
      const sync = await readGitRemoteSyncStatusFromOrigin(workspacePath, origin);
      if (sync.status !== "ready") {
        return { status: "failed", error: sync.status === "unavailable" ? sync.error : "Connect an origin first." };
      }
      if (sync.state === "no-local-commits") {
        return { status: "failed", error: "Create a local commit before pulling remote changes." };
      }
      if (sync.state === "unpublished") {
        return { status: "failed", error: `The remote has no ${sync.branch} branch to pull.` };
      }
      if (sync.state === "branch-missing") {
        return {
          status: "failed",
          error: `Origin does not contain a ${sync.branch} branch. Obim will not switch or combine branches automatically.`,
        };
      }
      if (sync.state === "diverged") {
        return {
          status: "failed",
          error:
            "Local and remote commits both contain changes. Use Resolve differences in Version History; Pull will not combine them automatically.",
        };
      }
      if (sync.state !== "behind")
        return successfulRemoteSyncResult(workspacePath, "up-to-date", undefined, testOptions);

      const oldHead = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "HEAD"]));
      const remoteRef = `refs/remotes/origin/${sync.branch}`;
      const remoteHead = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", remoteRef]));
      const incomingChanges = await readIncomingRemoteChanges(workspacePath, oldHead, remoteHead);
      const unsafeReason = await validateIncomingRemoteChanges(workspacePath, incomingChanges);
      if (unsafeReason) return { status: "failed", error: unsafeReason };
      const executableConfigError = await executableReconciliationConfigError(workspacePath);
      if (executableConfigError) return { status: "failed", error: executableConfigError };

      await runGit(
        workspacePath,
        [
          ...(hooksDirectory ? ["-c", `core.hooksPath=${hooksDirectory}`] : []),
          "merge",
          "--ff-only",
          "--quiet",
          remoteHead,
        ],
        { isolateUserConfig: true },
      );
      return successfulRemoteSyncResult(
        workspacePath,
        "pulled",
        incomingChanges.map(({ kind, path: changedPath }) => ({ kind, path: changedPath })),
        testOptions,
      );
    });
  } catch (error) {
    return { status: "failed", error: networkErrorMessage(error, "pulling") };
  }
};

const changedPathsFromSnapshot = (snapshot: GitReadyFileStatusSnapshot): GitRemoteChangedPath[] =>
  snapshot.changes.flatMap((change) => {
    if (change.originalPath) {
      return [
        { kind: "deleted" as const, path: change.originalPath },
        { kind: "added" as const, path: change.path },
      ];
    }
    return [
      {
        kind:
          change.kind === GIT_FILE_STATUS_KINDS.ADDED || change.kind === GIT_FILE_STATUS_KINDS.UNTRACKED
            ? ("added" as const)
            : change.kind === GIT_FILE_STATUS_KINDS.DELETED
              ? ("deleted" as const)
              : ("modified" as const),
        path: change.path,
      },
    ];
  });

const changedPathsAfterMutation = async (
  workspacePath: string,
  requestedPaths: readonly string[],
): Promise<GitRemoteChangedPath[]> =>
  Promise.all(
    [...new Set(requestedPaths)].map(async (requestedPath) => {
      let exists = false;
      try {
        await lstat(resolveWorkspacePath(workspacePath, requestedPath));
        exists = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      }
      return { kind: exists ? ("modified" as const) : ("deleted" as const), path: requestedPath };
    }),
  );

export const beginGitRemoteReconciliation = async (
  workspacePath: string,
  hooksDirectory?: string,
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncOperationResult> => {
  const repositoryLocation = await getMutableWorkspaceRepositoryLocation(workspacePath);
  if ("error" in repositoryLocation) return { status: "failed", error: repositoryLocation.error };
  const origin = await readOriginUrls(workspacePath, testOptions);
  if ("error" in origin) return { status: "failed", error: origin.error };

  let reconciliationStarted = false;
  let reconciliationGitDirectory: string | undefined;
  try {
    const sync = await readGitRemoteSyncStatusFromOrigin(workspacePath, origin);
    if (sync.status !== "ready") {
      return { status: "failed", error: sync.status === "unavailable" ? sync.error : "Connect an origin first." };
    }
    if (sync.state !== "diverged") {
      return {
        status: "failed",
        error:
          "Local and remote histories are no longer diverged. Refresh Version History and use the available action.",
      };
    }

    const localHead = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "HEAD"]));
    const remoteHead = trimFinalLineEnding(
      await runGit(workspacePath, ["rev-parse", `refs/remotes/origin/${sync.branch}`]),
    );
    const incomingChanges = await readIncomingRemoteChanges(workspacePath, localHead, remoteHead);
    const unsafeReason = await validateIncomingRemoteChanges(workspacePath, incomingChanges);
    if (unsafeReason) return { status: "failed", error: unsafeReason };
    const executableConfigError = await executableReconciliationConfigError(workspacePath);
    if (executableConfigError) return { status: "failed", error: executableConfigError };

    const repository = await getMutableWorkspaceRepository(workspacePath);
    if ("error" in repository) return { status: "failed", error: repository.error };
    if (repository.current.snapshot.mergeInProgress) {
      return { status: "failed", error: "A reconciliation is already in progress." };
    }
    if (repository.current.snapshot.changes.length > 0) {
      return {
        status: "failed",
        error: "Local files changed while preparing the differences. Reconciliation was not started.",
      };
    }
    if (repository.current.snapshot.branch !== sync.branch) {
      return {
        status: "failed",
        error: "The current branch changed while preparing the differences. Reconciliation was not started.",
      };
    }
    const [verifiedLocalHead, verifiedRemoteHead] = await Promise.all([
      runGit(workspacePath, ["rev-parse", "HEAD"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", `refs/remotes/origin/${sync.branch}`]).then(trimFinalLineEnding),
    ]);
    if (verifiedLocalHead !== localHead || verifiedRemoteHead !== remoteHead) {
      return {
        status: "failed",
        error: "The local or remote history changed while preparing the differences. Refresh and try again.",
      };
    }
    reconciliationGitDirectory = repository.current.gitDirectory ?? repositoryLocation.gitDirectory;
    // Capture exact worktree bytes as well as HEAD: built-in Git newline/encoding
    // transformations mean a clean working file need not equal its stored blob.
    await removeGitReconciliationState(reconciliationGitDirectory);
    const baseline = await captureReconciliationBaseline(
      workspacePath,
      reconciliationGitDirectory,
      incomingChanges.map((change) => change.path),
    );
    await writeGitReconciliationState(reconciliationGitDirectory, {
      ...baseline,
      branch: sync.branch,
      localHead,
      remoteHead,
      worktreeVersions: await readWorktreeVersions(
        workspacePath,
        incomingChanges.map((change) => change.path),
      ),
    });

    let mergeError: unknown;
    let mergeCommandSucceeded = false;
    // From this point, any unexpected verification failure must attempt a rollback;
    // Git may have changed the index/worktree even when the command itself errors.
    reconciliationStarted = true;
    try {
      await runGit(
        workspacePath,
        [
          ...(hooksDirectory ? ["-c", `core.hooksPath=${hooksDirectory}`] : []),
          "merge",
          "--no-autostash",
          "--no-commit",
          "--no-edit",
          "--no-ff",
          "--quiet",
          remoteHead,
        ],
        { isolateUserConfig: true },
      );
      mergeCommandSucceeded = true;
    } catch (error) {
      mergeError = error;
    }

    let mergeHeadRevision: string | undefined;
    try {
      mergeHeadRevision = trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "--verify", "MERGE_HEAD"]));
    } catch (error) {
      if (!(error instanceof GitProcessError) || error.exitCode !== 128) throw error;
    }
    const conflictStages = parseConflictStages(await runGit(workspacePath, ["ls-files", "--unmerged", "-z"]));
    const hasConflicts = conflictStages.size > 0;
    if (mergeError && (!mergeHeadRevision || !hasConflicts)) throw mergeError;
    if (!mergeHeadRevision) {
      if (mergeCommandSucceeded) {
        throw new Error("Git entered reconciliation, but Obim could not verify its prepared state.");
      }
      throw new GitProcessError("Git did not enter a reviewable reconciliation state.");
    }
    if (mergeHeadRevision !== remoteHead) {
      throw new Error("Git prepared a reconciliation for an unexpected remote revision.");
    }

    const conflictedPaths = new Set(conflictStages.keys());
    const automaticallyStagedPaths = [
      ...new Set(
        (await runGit(workspacePath, ["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"]))
          .toString("utf8")
          .split("\0")
          .filter((changedPath) => changedPath && !conflictedPaths.has(changedPath)),
      ),
    ];
    if (automaticallyStagedPaths.length > 0) {
      await runGit(workspacePath, ["reset", "--quiet", "HEAD", "--", ...automaticallyStagedPaths]);
    }
    const prepared = await readGitFileStatus(workspacePath);
    if (prepared.snapshot.status !== "ready" || !prepared.snapshot.mergeInProgress) {
      throw new Error("Git could not prepare the differences as unstaged files.");
    }
    if (prepared.snapshot.changes.some((change) => !change.conflicted && change.staged)) {
      throw new Error("Git left automatically merged files staged during reconciliation.");
    }
    if (
      [...conflictedPaths].some(
        (conflictedPath) =>
          !prepared.snapshot.changes.some((change) => change.path === conflictedPath && change.conflicted),
      )
    ) {
      throw new Error("Git did not preserve every conflict while preparing the differences.");
    }
    const affectedPaths = prepared.snapshot.changes.flatMap((change) => [
      change.path,
      ...(change.originalPath ? [change.originalPath] : []),
    ]);

    const reconciliationState = {
      ...baseline,
      branch: sync.branch,
      localHead,
      remoteHead,
      worktreeVersions: await readWorktreeVersions(workspacePath, affectedPaths),
    } satisfies GitReconciliationState;
    await writeGitReconciliationState(reconciliationGitDirectory, reconciliationState);
    const [markedState, markedBranch, markedHead, markedMergeHead] = await Promise.all([
      readGitReconciliationState(reconciliationGitDirectory),
      runGit(workspacePath, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", "--verify", "HEAD"]).then(trimFinalLineEnding),
      runGit(workspacePath, ["rev-parse", "--verify", "MERGE_HEAD"]).then(trimFinalLineEnding),
    ]);
    if (
      !markedState ||
      markedState.branch !== markedBranch ||
      markedState.localHead !== markedHead ||
      markedState.remoteHead !== markedMergeHead
    ) {
      throw new Error("Obim could not record the reconciliation state safely.");
    }

    reconciliationStarted = false;
    return {
      status: "succeeded",
      action: "reconciliation-started",
      changedPaths: changedPathsFromSnapshot(prepared.snapshot),
      snapshot: { ...prepared.snapshot, remoteReconciliationInProgress: true },
      sync,
    };
  } catch (error) {
    if (reconciliationStarted) {
      // Reuse the same guarded restoration as an explicit cancel. Never discard
      // snapshots after an incomplete rollback, including a failed merge command.
      let rollback: GitConflictOperationResult | undefined;
      try {
        const state = reconciliationGitDirectory
          ? await readGitReconciliationState(reconciliationGitDirectory)
          : undefined;
        if (state) {
          state.cancelling = true;
          await writeGitReconciliationState(reconciliationGitDirectory!, state);
          rollback = await abortGitRemoteReconciliation(workspacePath);
        }
      } catch {
        /* The recorded baseline remains available for retry or inspection. */
      }
      return {
        status: "failed",
        error:
          rollback?.status === "succeeded"
            ? gitErrorMessage(error, "Git could not prepare the remote differences safely.")
            : `Git could not prepare or fully cancel the reconciliation. The local baseline was retained. ${rollback?.status === "failed" ? rollback.error : "Inspect Git status before continuing."}`,
      };
    }
    return { status: "failed", error: networkErrorMessage(error, "pulling") };
  }
};

const conflictStagesForPath = async (workspacePath: string, requestedPath: string) => {
  const stages = parseConflictStages(
    await runGit(workspacePath, ["ls-files", "--unmerged", "-z", "--", requestedPath]),
  );
  return stages.get(requestedPath) ?? [];
};

const decodeConflictText = (content: Buffer) => {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
};

const readConflictStagePreview = async (workspacePath: string, stage?: ConflictStage) => {
  if (!stage) return { status: "deleted" as const };
  if (stage.mode !== "100644" && stage.mode !== "100755") {
    throw new Error("Symlink and submodule conflicts cannot be reviewed inside Obim.");
  }
  const sizeValue = trimFinalLineEnding(await runGit(workspacePath, ["cat-file", "-s", stage.objectId]));
  const sizeBytes = Number(sizeValue);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error("Git returned an invalid file size.");
  if (sizeBytes > MAX_FULL_TEXT_EDITOR_BYTES) return { status: "too-large" as const, sizeBytes };

  const content = await runGit(workspacePath, ["cat-file", "blob", stage.objectId], {
    outputLimitBytes: MAX_FULL_TEXT_EDITOR_BYTES + 1_024,
  });
  const decoded = decodeConflictText(content);
  return decoded === null
    ? { status: "binary" as const, sizeBytes }
    : { status: "ready" as const, content: decoded, sizeBytes };
};

export const readGitConflictPreview = async (
  workspacePath: string,
  requestedPath: string,
): Promise<GitConflictPreviewResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (!repository.current.snapshot.remoteReconciliationInProgress) {
    return { status: "failed", error: "There is no remote reconciliation in progress." };
  }
  const change = repository.current.snapshot.changes.find(
    (candidate) => candidate.path === requestedPath && candidate.conflicted,
  );
  if (!change || !requestedPath || requestedPath.includes("\0")) {
    return { status: "failed", error: "Select a current conflicted file." };
  }

  try {
    resolveWorkspacePath(workspacePath, requestedPath);
    const stages = await conflictStagesForPath(workspacePath, requestedPath);
    const baseStage = stages.find((stage) => stage.stage === 1);
    const localStage = stages.find((stage) => stage.stage === 2);
    const remoteStage = stages.find((stage) => stage.stage === 3);
    const [base, local, remote] = await Promise.all([
      readConflictStagePreview(workspacePath, baseStage),
      readConflictStagePreview(workspacePath, localStage),
      readConflictStagePreview(workspacePath, remoteStage),
    ]);
    return { status: "ready", base, local, remote };
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not read the conflicted versions.") };
  }
};

const uniqueConflictCopyPath = async (workspacePath: string, requestedPath: string) => {
  const extension = path.posix.extname(requestedPath);
  const basePath = extension ? requestedPath.slice(0, -extension.length) : requestedPath;
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? " — remote" : ` — remote ${index + 1}`;
    const candidate = `${basePath}${suffix}${extension}`;
    const destinationPath = resolveWorkspacePath(workspacePath, candidate);
    if (!(await pathExists(destinationPath))) return { destinationPath, relativePath: candidate };
  }
  throw new Error("Obim could not choose a safe filename for the remote copy.");
};

const uniqueReconciliationRecoveryPath = async (workspacePath: string, requestedPath: string) => {
  const extension = path.posix.extname(requestedPath);
  const basePath = extension ? requestedPath.slice(0, -extension.length) : requestedPath;
  for (let index = 0; index < 10_000; index += 1) {
    const suffix = index === 0 ? " — reconciliation edit" : ` — reconciliation edit ${index + 1}`;
    const candidate = `${basePath}${suffix}${extension}`;
    const destinationPath = resolveWorkspacePath(workspacePath, candidate);
    if (!(await pathExists(destinationPath))) return { destinationPath, relativePath: candidate };
  }
  throw new Error("Obim could not choose a safe filename for a reconciliation recovery copy.");
};

const readRegularWorktreeFile = async (filePath: string) => {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("The conflicted path is no longer a regular file.");
    if (before.size > GIT_CONFLICT_BLOB_LIMIT_BYTES) {
      throw new Error("The conflicted file is too large to resolve safely inside Obim.");
    }
    const content = await handle.readFile();
    const after = await handle.stat();
    const current = await lstat(filePath);
    const beforeVersion = toWorkspaceFileVersion(before);
    const afterVersion = toWorkspaceFileVersion(after);
    const currentVersion = toWorkspaceFileVersion(current);
    if (
      !workspaceFileVersionsEqual(beforeVersion, afterVersion) ||
      !workspaceFileVersionsEqual(afterVersion, currentVersion)
    ) {
      throw new Error("The conflicted file changed while Obim was reading it.");
    }
    return { content, mode: before.mode & 0o777, version: currentVersion };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  } finally {
    await handle?.close();
  }
};

const atomicallyReplaceWorktreeFile = async (filePath: string, content: Buffer, mode: number) => {
  const temporaryPath = path.join(path.dirname(filePath), `.obim-reconcile-${randomUUID()}`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode });
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

const restoreConflictStages = async (
  workspacePath: string,
  requestedPath: string,
  stages: readonly ConflictStage[],
) => {
  const input = Buffer.from(
    stages.map((stage) => `${stage.mode} ${stage.objectId} ${stage.stage}\t${requestedPath}\0`).join(""),
  );
  await runGit(workspacePath, ["update-index", "-z", "--index-info"], { input });
};

export const resolveGitConflict = async (
  workspacePath: string,
  requestedPath: string,
  resolution: GitConflictResolution,
): Promise<GitConflictOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (!repository.current.snapshot.remoteReconciliationInProgress) {
    return { status: "failed", error: "There is no remote reconciliation in progress." };
  }
  const change = repository.current.snapshot.changes.find(
    (candidate) => candidate.path === requestedPath && candidate.conflicted,
  );
  if (!change || !requestedPath || requestedPath.includes("\0")) {
    return { status: "failed", error: "Select a current conflicted file." };
  }

  try {
    const targetPath = resolveWorkspacePath(workspacePath, requestedPath);
    const reconciliationState = repository.current.gitDirectory
      ? await readGitReconciliationState(repository.current.gitDirectory)
      : undefined;
    if (!reconciliationState || !Object.hasOwn(reconciliationState.worktreeVersions, requestedPath)) {
      return { status: "failed", error: "Obim could not verify the prepared file before changing it." };
    }
    const expectedVersion = reconciliationState.worktreeVersions[requestedPath] ?? null;
    const currentVersion = await readWorktreeVersion(workspacePath, requestedPath);
    if (!worktreeVersionsEqual(expectedVersion, currentVersion)) {
      return {
        status: "failed",
        error: `Obim did not replace ${requestedPath} because it changed after reconciliation began. Cancel reconciliation to preserve that edit, or restore the prepared file before choosing a version.`,
      };
    }
    const stages = await conflictStagesForPath(workspacePath, requestedPath);
    const baseStage = stages.find((stage) => stage.stage === 1);
    const localStage = stages.find((stage) => stage.stage === 2);
    const remoteStage = stages.find((stage) => stage.stage === 3);
    const safeMode = (stage?: ConflictStage) => !stage || stage.mode === "100644" || stage.mode === "100755";
    if (!safeMode(baseStage) || !safeMode(localStage) || !safeMode(remoteStage)) {
      return { status: "failed", error: "Symlink and submodule conflicts cannot be resolved inside Obim." };
    }
    const previousFile = await readRegularWorktreeFile(targetPath);
    if (!worktreeVersionsEqual(expectedVersion, previousFile?.version ?? null)) {
      return {
        status: "failed",
        error: `Obim did not replace ${requestedPath} because it changed while the choice was being prepared.`,
      };
    }
    let savedBothPath: string | undefined;
    let savedBothDestinationPath: string | undefined;
    let indexReset = false;
    const changedPaths: GitRemoteChangedPath[] = [];
    try {
      let selectedStage = resolution === "keep-local" ? localStage : remoteStage;
      let selectedContent: Buffer | null = selectedStage
        ? await runGit(workspacePath, ["cat-file", "blob", selectedStage.objectId], {
            outputLimitBytes: GIT_CONFLICT_BLOB_LIMIT_BYTES,
          })
        : null;

      if (resolution === "save-both") {
        if (!localStage || !remoteStage) {
          return {
            status: "failed",
            error: "Save both is unavailable because one side deleted this file. Choose Keep local or Use remote.",
          };
        }
        selectedStage = localStage;
        selectedContent = await runGit(workspacePath, ["cat-file", "blob", localStage.objectId], {
          outputLimitBytes: GIT_CONFLICT_BLOB_LIMIT_BYTES,
        });
        const remoteContent = await runGit(workspacePath, ["cat-file", "blob", remoteStage.objectId], {
          outputLimitBytes: GIT_CONFLICT_BLOB_LIMIT_BYTES,
        });
        const copy = await uniqueConflictCopyPath(workspacePath, requestedPath);
        if (await hasSymlinkAncestor(workspacePath, copy.relativePath)) {
          return {
            status: "failed",
            error:
              "The separate remote file would be written through a symbolic-link directory. Obim did not create it.",
          };
        }
        const [canonicalWorkspace, canonicalDestinationDirectory] = await Promise.all([
          realpath(workspacePath),
          realpath(path.dirname(copy.destinationPath)),
        ]);
        const relativeDestinationDirectory = path.relative(canonicalWorkspace, canonicalDestinationDirectory);
        if (
          relativeDestinationDirectory === ".." ||
          relativeDestinationDirectory.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeDestinationDirectory)
        ) {
          return {
            status: "failed",
            error: "The separate remote file would be created outside the workspace. Obim did not create it.",
          };
        }
        await writeFile(copy.destinationPath, remoteContent, {
          flag: "wx",
          mode: remoteStage.mode === "100755" ? 0o755 : 0o644,
        });
        savedBothPath = copy.relativePath;
        savedBothDestinationPath = copy.destinationPath;
      }

      const versionBeforeApply = await readWorktreeVersion(workspacePath, requestedPath);
      if (!worktreeVersionsEqual(expectedVersion, versionBeforeApply)) {
        throw new Error(`${requestedPath} changed while the choice was being prepared.`);
      }
      await runGit(workspacePath, ["reset", "--quiet", "HEAD", "--", requestedPath]);
      indexReset = true;
      if (selectedContent !== null && selectedStage) {
        await atomicallyReplaceWorktreeFile(
          targetPath,
          selectedContent,
          selectedStage.mode === "100755" ? 0o755 : 0o644,
        );
        changedPaths.push({ kind: baseStage ? "modified" : "added", path: requestedPath });
      } else {
        await rm(targetPath, { force: true });
        changedPaths.push({ kind: "deleted", path: requestedPath });
      }
      if (savedBothPath) changedPaths.push({ kind: "added", path: savedBothPath });

      const refreshed = await readGitFileStatus(workspacePath);
      if (refreshed.snapshot.status !== "ready") {
        throw new Error("The conflict choice was applied, but Git status could not be refreshed.");
      }
      reconciliationState.worktreeVersions[requestedPath] = await readWorktreeVersion(workspacePath, requestedPath);
      if (savedBothPath) {
        reconciliationState.worktreeVersions[savedBothPath] = await readWorktreeVersion(workspacePath, savedBothPath);
      }
      await writeGitReconciliationState(repository.current.gitDirectory!, reconciliationState);
      return {
        status: "succeeded",
        changedPaths,
        ...(savedBothPath ? { savedBothPath } : {}),
        snapshot: refreshed.snapshot,
      };
    } catch (error) {
      let restored = true;
      if (indexReset) {
        try {
          if (previousFile) {
            await atomicallyReplaceWorktreeFile(targetPath, previousFile.content, previousFile.mode);
          } else {
            await rm(targetPath, { force: true });
          }
          await restoreConflictStages(workspacePath, requestedPath, stages);
        } catch {
          restored = false;
        }
      }
      if (savedBothDestinationPath) await rm(savedBothDestinationPath, { force: true }).catch(() => undefined);
      return {
        status: "failed",
        error: restored
          ? gitErrorMessage(error, "Git could not apply that conflict choice.")
          : "The conflict choice could not be completed or fully rolled back. No commit or push was made; inspect this file and Git status before continuing.",
      };
    }
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not apply that conflict choice.") };
  }
};

export const abortGitRemoteReconciliation = async (workspacePath: string): Promise<GitConflictOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (!repository.current.snapshot.remoteReconciliationInProgress) {
    return { status: "failed", error: "There is no remote reconciliation in progress." };
  }
  const recoveryPaths: string[] = [];
  try {
    const reconciliationState = repository.current.gitDirectory
      ? await readGitReconciliationState(repository.current.gitDirectory)
      : undefined;
    if (!reconciliationState) {
      return { status: "failed", error: "Obim could not verify the reconciliation before cancelling it." };
    }
    const executableConfigError = await executableReconciliationConfigError(workspacePath);
    if (executableConfigError) return { status: "failed", error: executableConfigError };
    recoveryPaths.push(...(reconciliationState.recoveryPaths ?? []));
    const changedSincePrepared = await changedTrackedReconciliationPaths(workspacePath, reconciliationState);
    for (const relativePath of changedSincePrepared) {
      const currentFile = await readRegularWorktreeFile(resolveWorkspacePath(workspacePath, relativePath));
      if (!currentFile && reconciliationState.worktreeVersions[relativePath] !== null) {
        return {
          status: "failed",
          error: `${relativePath} was deleted during reconciliation. Cancellation is paused to preserve that deletion. Restore that file before retrying, or finish the reconciliation with the deletion. The local baseline is still recorded.`,
        };
      }
    }
    for (const relativePath of changedSincePrepared) {
      const currentFile = await readRegularWorktreeFile(resolveWorkspacePath(workspacePath, relativePath));
      if (!currentFile) continue;
      const recovery = await uniqueReconciliationRecoveryPath(workspacePath, relativePath);
      await writeFile(recovery.destinationPath, currentFile.content, {
        flag: "wx",
        mode: currentFile.mode,
      });
      recoveryPaths.push(recovery.relativePath);
      reconciliationState.recoveryPaths = recoveryPaths;
      // A version guard below ensures edits made after the recovery copy are not replaced.
      reconciliationState.worktreeVersions[relativePath] = currentFile.version;
      await writeGitReconciliationState(repository.current.gitDirectory!, reconciliationState);
    }
    const affectedPaths = Object.keys(reconciliationState.worktreeVersions);
    reconciliationState.cancelling = true;
    await writeGitReconciliationState(repository.current.gitDirectory!, reconciliationState);
    for (const relativePath of affectedPaths) {
      if (await hasSymlinkAncestor(workspacePath, relativePath)) {
        throw new GitProcessError(
          `${relativePath} now has a symbolic-link parent. Cancellation is paused; its baseline is retained.`,
        );
      }
      const targetPath = resolveWorkspacePath(workspacePath, relativePath);
      const tree = await runGit(workspacePath, ["ls-tree", "-z", reconciliationState.localHead, "--", relativePath]);
      const entry = /^(100644|100755) blob ([0-9a-f]+)\t/u.exec(tree.toString("utf8"));
      if (tree.length && !entry) throw new GitProcessError(`${relativePath} has an unsupported baseline file type.`);
      const originalFile = reconciliationState.localFiles?.[relativePath];
      // Older sessions lack snapshots; retain their clean-HEAD fallback.
      const baseline = originalFile
        ? await readFile(
            path.join(
              repository.current.gitDirectory!,
              reconciliationState.baselineDirectory!,
              originalFile.contentFile,
            ),
          )
        : originalFile === null
          ? null
          : entry
            ? await runGit(workspacePath, ["cat-file", "blob", entry[2]], {
                outputLimitBytes: GIT_CONFLICT_BLOB_LIMIT_BYTES,
              })
            : null;
      const baselineMode = originalFile?.mode ?? (entry?.[1] === "100755" ? 0o755 : 0o644);
      const expectedVersion = reconciliationState.worktreeVersions[relativePath] ?? null;
      if (!worktreeVersionsEqual(expectedVersion, await readWorktreeVersion(workspacePath, relativePath))) {
        throw new GitProcessError(
          `${relativePath} changed while cancellation was preparing. Its contents were preserved; retry cancellation.`,
        );
      }
      // Reset only this index entry. Never let merge --abort decide which unstaged
      // prepared files are user edits: Obim knows their recorded local baseline.
      await runGit(workspacePath, ["reset", "--quiet", reconciliationState.localHead, "--", relativePath]);
      if (!worktreeVersionsEqual(expectedVersion, await readWorktreeVersion(workspacePath, relativePath))) {
        throw new GitProcessError(
          `${relativePath} changed during cancellation. Its contents were preserved; retry cancellation.`,
        );
      }
      if (baseline) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await atomicallyReplaceWorktreeFile(targetPath, baseline, baselineMode);
      } else {
        await rm(targetPath, { force: true });
      }
      const restored = await readRegularWorktreeFile(targetPath);
      if (baseline ? !restored?.content.equals(baseline) || restored.mode !== baselineMode : restored !== null) {
        throw new GitProcessError(
          `${relativePath} could not be verified after restoration. The cancellation state was retained.`,
        );
      }
      reconciliationState.worktreeVersions[relativePath] = restored?.version ?? null;
      await writeGitReconciliationState(repository.current.gitDirectory!, reconciliationState);
    }
    // Verify the scoped index independently before discarding merge bookkeeping.
    if (
      affectedPaths.length &&
      (
        await runGit(workspacePath, [
          "diff",
          "--cached",
          "--name-only",
          "-z",
          reconciliationState.localHead,
          "--",
          ...affectedPaths,
        ])
      ).length
    ) {
      throw new GitProcessError(
        "The local index could not be fully restored. Cancellation can be retried; its baseline was retained.",
      );
    }
    if ((await changedTrackedReconciliationPaths(workspacePath, reconciliationState)).length) {
      throw new GitProcessError(
        "A restored file changed before cancellation finished. Its contents and the cancellation state were preserved.",
      );
    }
    if (trimFinalLineEnding(await runGit(workspacePath, ["rev-parse", "HEAD"])) !== reconciliationState.localHead) {
      throw new GitProcessError(
        "The local branch changed during cancellation. The recorded baseline was retained for inspection.",
      );
    }
    await runGit(workspacePath, ["merge", "--quit"], { isolateUserConfig: true });
    await removeGitReconciliationState(repository.current.gitDirectory);
    const changedPaths = await changedPathsAfterMutation(workspacePath, affectedPaths);
    changedPaths.push(...recoveryPaths.map((relativePath) => ({ kind: "added" as const, path: relativePath })));
    const refreshed = await readGitFileStatus(workspacePath);
    return refreshed.snapshot.status === "ready"
      ? {
          status: "succeeded",
          changedPaths,
          ...(recoveryPaths.length > 0 ? { recoveryPaths } : {}),
          snapshot: refreshed.snapshot,
        }
      : { status: "failed", error: "Reconciliation was cancelled, but Git status could not be refreshed." };
  } catch (error) {
    const recoveryNotice =
      recoveryPaths.length > 0 ? ` Edited files were preserved as: ${recoveryPaths.join(", ")}.` : "";
    return {
      status: "failed",
      error: `${gitErrorMessage(error, "Git could not cancel the reconciliation safely.")}${recoveryNotice}`,
    };
  }
};

export const pushGitRemote = async (
  workspacePath: string,
  hooksDirectory?: string,
  testOptions?: RemoteGitTestOptions,
): Promise<GitRemoteSyncOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: reconciliationRemoteActionError };
  }
  const origin = await readOriginUrls(workspacePath, testOptions);
  if ("error" in origin) return { status: "failed", error: origin.error };

  const capturedHead = (await readGitSyncLocalState(workspacePath)).localRevision;
  let uploadedRevision: string | undefined;
  try {
    const capturedBranch = trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "HEAD"]));
    await fetchOriginRefs(workspacePath, origin, hooksDirectory, testOptions);
    if (
      !(await originStillMatches(workspacePath, origin, testOptions)) ||
      (await readGitSyncLocalState(workspacePath)).localRevision !== capturedHead ||
      trimFinalLineEnding(await runGit(workspacePath, ["symbolic-ref", "--quiet", "HEAD"])) !== capturedBranch ||
      (testOptions?.expectedHead && testOptions.expectedHead !== capturedHead)
    ) {
      return {
        status: "failed",
        error: "The local history or destination changed while checking the remote. Nothing was pushed.",
      };
    }
    const sync = await readGitRemoteSyncStatus(workspacePath, testOptions);
    if (sync.status !== "ready") {
      return { status: "failed", error: sync.status === "unavailable" ? sync.error : "Connect an origin first." };
    }
    if (sync.state === "no-local-commits") {
      return { status: "failed", error: "Create and commit at least one local version before pushing." };
    }
    if (sync.state === "branch-missing") {
      return {
        status: "failed",
        error: `Origin already contains other branches but no ${sync.branch} branch. Obim refused to publish an unexpected branch.`,
      };
    }
    if (sync.state === "behind" || sync.state === "diverged") {
      return {
        status: "failed",
        error:
          sync.state === "behind"
            ? `Origin has ${sync.behind} newer ${sync.behind === 1 ? "commit" : "commits"}. Pull before pushing.`
            : "Local and remote histories have diverged. Obim will not force-push or overwrite remote commits.",
      };
    }
    if (sync.state === "up-to-date") {
      return successfulRemoteSyncResult(workspacePath, "up-to-date", undefined, testOptions);
    }

    const localHead = capturedHead!;
    const remoteRef = `refs/remotes/origin/${sync.branch}`;
    await beforeGitNetwork(workspacePath, testOptions, "push");
    if (!(await originStillMatches(workspacePath, origin, testOptions)))
      throw new GitProcessError("The remote destination changed before pushing.");
    await runGit(
      workspacePath,
      [
        ...(hooksDirectory ? ["-c", `core.hooksPath=${hooksDirectory}`] : []),
        "-c",
        "push.gpgSign=false",
        "push",
        "--porcelain",
        origin.pushUrl,
        `${localHead}:refs/heads/${sync.branch}`,
      ],
      { timeoutMs: GIT_NETWORK_TIMEOUT_MS, signal: testOptions?.signal },
    );
    uploadedRevision = localHead;
    await runGit(workspacePath, ["update-ref", remoteRef, localHead]);
    await runGit(workspacePath, ["config", "--local", `branch.${sync.branch}.remote`, "origin"]);
    await runGit(workspacePath, ["config", "--local", `branch.${sync.branch}.merge`, `refs/heads/${sync.branch}`]);
    const refreshed = await successfulRemoteSyncResult(workspacePath, "pushed", undefined, testOptions);
    return { ...refreshed, uploadedRevision: localHead };
  } catch (error) {
    return {
      status: "failed",
      error: networkErrorMessage(error, "pushing"),
      ...(uploadedRevision ? { uploadedRevision } : {}),
    };
  }
};

const getSelectedGitPaths = (requestedPaths: readonly string[], changes: readonly GitFileChange[]) => {
  const selectedChanges = new Map(changes.map((change) => [change.path, change]));
  const paths = new Set<string>();

  for (const requestedPath of requestedPaths) {
    if (!requestedPath || requestedPath.includes("\0")) return null;
    const change = selectedChanges.get(requestedPath);
    if (!change) return null;
    paths.add(change.path);
    if (change.originalPath) paths.add(change.originalPath);
  }
  return [...paths];
};

const refreshedOperationResult = async (workspacePath: string): Promise<GitOperationResult> => {
  const refreshed = await readGitFileStatus(workspacePath);
  return refreshed.snapshot.status === "ready"
    ? { status: "succeeded", snapshot: refreshed.snapshot }
    : { status: "failed", error: "Git changed the repository, but its updated status could not be read." };
};

export const stageGitPaths = async (
  workspacePath: string,
  requestedPaths: readonly string[],
): Promise<GitOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  const requestedChanges = requestedPaths.map((requestedPath) =>
    repository.current.snapshot.changes.find((change) => change.path === requestedPath),
  );
  if (requestedChanges.some((change) => change?.conflicted)) {
    return { status: "failed", error: "Resolve merge conflicts before staging this file." };
  }
  const paths = getSelectedGitPaths(requestedPaths, repository.current.snapshot.changes);
  if (!paths?.length) return { status: "failed", error: "Select at least one current workspace change to stage." };

  try {
    const executableConfigError = await executableReconciliationConfigError(workspacePath);
    if (executableConfigError) return { status: "failed", error: executableConfigError };
    await runGit(workspacePath, ["add", "--all", "--", ...paths], { isolateUserConfig: true });
    return refreshedOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not stage the selected changes.") };
  }
};

export const unstageGitPaths = async (
  workspacePath: string,
  requestedPaths: readonly string[],
): Promise<GitOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (
    requestedPaths.some((requestedPath) =>
      repository.current.snapshot.changes.find((change) => change.path === requestedPath && change.conflicted),
    )
  ) {
    return { status: "failed", error: "Resolve merge conflicts before changing staged files." };
  }
  const paths = getSelectedGitPaths(requestedPaths, repository.current.snapshot.changes);
  if (!paths?.length) return { status: "failed", error: "Select at least one current workspace change to unstage." };

  let hasHead = true;
  try {
    await runGit(workspacePath, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    hasHead = false;
  }

  try {
    if (hasHead) await runGit(workspacePath, ["reset", "--quiet", "HEAD", "--", ...paths]);
    else await runGit(workspacePath, ["rm", "--cached", "--quiet", "--ignore-unmatch", "--", ...paths]);
    return refreshedOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not unstage the selected changes.") };
  }
};

/**
 * Restores tracked paths to HEAD in both the index and working tree. New and
 * untracked files are deliberately rejected so this operation never deletes a
 * note that has no saved Git version.
 */
export const revertGitPaths = async (
  workspacePath: string,
  requestedPaths: readonly string[],
): Promise<GitOperationResult> => {
  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };

  const currentChanges: readonly GitFileChange[] = repository.current.snapshot.changes;
  const changesByPath = new Map(currentChanges.map((change) => [change.path, change] as const));
  const selectedChanges = requestedPaths.map((requestedPath) => changesByPath.get(requestedPath));
  if (
    requestedPaths.length === 0 ||
    selectedChanges.some((change) => !change) ||
    requestedPaths.some((requestedPath) => !requestedPath || requestedPath.includes("\0"))
  ) {
    return { status: "failed", error: "Select at least one current workspace change to revert." };
  }
  if (selectedChanges.some((change) => !isGitChangeRevertible(change!))) {
    return {
      status: "failed",
      error: selectedChanges.some((change) => change?.conflicted)
        ? "Resolve merge conflicts before reverting files."
        : "New files cannot be reverted because they do not have a committed version.",
    };
  }

  const paths = getSelectedGitPaths(requestedPaths, currentChanges);
  if (!paths?.length) return { status: "failed", error: "Select at least one current workspace change to revert." };

  try {
    await runGit(workspacePath, ["rev-parse", "--verify", "HEAD"]);
  } catch {
    return { status: "failed", error: "There is no committed version to restore yet." };
  }

  try {
    await runGit(workspacePath, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]);
    return refreshedOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not revert the selected changes.") };
  }
};

export const commitGitChanges = async (
  workspacePath: string,
  rawMessage: string,
  hooksDirectory?: string,
): Promise<GitOperationResult> => {
  const message = rawMessage.trim();
  if (!message) return { status: "failed", error: "Enter a commit message first." };
  if (message.length > 10_000) return { status: "failed", error: "The commit message is too long." };

  const repository = await getMutableWorkspaceRepository(workspacePath);
  if ("error" in repository) return { status: "failed", error: repository.error };
  if (repository.current.snapshot.changes.some((change) => change.conflicted)) {
    return { status: "failed", error: "Resolve merge conflicts before committing." };
  }
  if (
    repository.current.snapshot.mergeInProgress &&
    repository.current.snapshot.changes.some((change) => change.workingTreeChanged)
  ) {
    return {
      status: "failed",
      error: "Review and resolve every reconciliation change before creating the merge commit.",
    };
  }
  const hasStagedChanges = repository.current.snapshot.changes.some((change) => change.staged);
  if (!hasStagedChanges && !repository.current.snapshot.mergeInProgress) {
    return { status: "failed", error: "Stage at least one change before committing." };
  }

  try {
    await runGit(workspacePath, [
      ...(await commitIdentityConfiguration(workspacePath)),
      ...(hooksDirectory ? ["-c", `core.hooksPath=${hooksDirectory}`] : []),
      "-c",
      "commit.gpgSign=false",
      "commit",
      "--quiet",
      "-m",
      message,
    ]);
    await removeGitReconciliationState(repository.current.gitDirectory).catch(() => undefined);
    return refreshedOperationResult(workspacePath);
  } catch (error) {
    return { status: "failed", error: gitErrorMessage(error, "Git could not create the commit.") };
  }
};

/** Synchronizes committed history and resolves a divergent merge using the user's preselected policy. */
export const autoSyncGitRemote = async (
  workspacePath: string,
  conflictResolution: Extract<GitConflictResolution, "keep-local" | "use-remote">,
  hooksDirectory?: string,
  testOptions?: RemoteGitTestOptions,
  expectedDestination?: string,
): Promise<GitAutoSyncResult> => {
  let localCommitCreated = false;
  const execute = async (): Promise<GitAutoSyncResult> => {
    try {
      const initial = await runLocalGitPhase(testOptions, async () => {
        const destination = await readGitAutoSyncDestination(workspacePath, testOptions);
        if ("error" in destination) return { status: "failed" as const, error: destination.error };
        if (expectedDestination && expectedDestination !== destination.destination) {
          return {
            status: "failed" as const,
            error: "The remote destination changed. Review and enable auto-sync for this destination in Settings.",
          };
        }
        const current = await getMutableWorkspaceRepository(workspacePath);
        if ("error" in current) return { status: "failed" as const, error: current.error };
        if (current.current.snapshot.mergeInProgress)
          return { status: "failed" as const, error: "Finish or cancel the current merge before auto-syncing." };
        if (current.current.snapshot.changes.length > 0) {
          const staged = await stageGitPaths(
            workspacePath,
            current.current.snapshot.changes.map((change) => change.path),
          );
          if (staged.status === "failed") return staged;
          const committed = await commitGitChanges(workspacePath, "Automatic sync", hooksDirectory);
          if (committed.status === "failed") return committed;
          localCommitCreated = true;
        }
        return {
          status: "ready" as const,
          destination: destination.destination,
          head: (await readGitSyncLocalState(workspacePath)).localRevision,
        };
      });
      if (initial.status === "failed") return initial;
      const options = { ...testOptions, expectedHead: initial.head, expectedDestination: initial.destination };
      const validateCheckpoint = async () => {
        const destination = await readGitAutoSyncDestination(workspacePath, options);
        return (
          !("error" in destination) &&
          destination.destination === initial.destination &&
          (await readGitSyncLocalState(workspacePath)).localRevision === initial.head
        );
      };
      const fetched = await fetchGitRemote(workspacePath, hooksDirectory, options);
      if (fetched.status === "failed") return fetched;
      if (!(await validateCheckpoint()))
        return {
          status: "failed",
          error:
            "Local history or the destination changed while synchronization was waiting. Retry to review the current state.",
        };
      if (fetched.sync.state === "behind") {
        const pulled = await pullGitRemote(workspacePath, hooksDirectory, options);
        return pulled.status === "failed"
          ? pulled
          : { ...pulled, action: pulled.action === "pulled" ? "pulled" : "up-to-date" };
      }
      if (fetched.sync.state === "ahead" || fetched.sync.state === "unpublished") {
        const pushed = await pushGitRemote(workspacePath, hooksDirectory, options);
        return pushed.status === "failed"
          ? pushed
          : { ...pushed, action: pushed.action === "pushed" ? "pushed" : "up-to-date" };
      }
      if (fetched.sync.state !== "diverged") return { ...fetched, action: "up-to-date" };

      const merged = await runLocalGitPhase(options, async () => {
        if (!(await validateCheckpoint()))
          return {
            status: "failed" as const,
            error: "Local history or the destination changed before reconciliation. Nothing was combined.",
          };
        const prepared = await beginGitRemoteReconciliation(workspacePath, hooksDirectory, options);
        if (prepared.status === "failed") return prepared;
        const changedPaths = [...(prepared.changedPaths ?? [])];
        let snapshot = prepared.snapshot;
        for (const conflict of snapshot.changes.filter((change) => change.conflicted)) {
          const resolved = await resolveGitConflict(workspacePath, conflict.path, conflictResolution);
          if (resolved.status === "failed") return resolved;
          changedPaths.push(...resolved.changedPaths);
          snapshot = resolved.snapshot;
        }
        if (snapshot.changes.some((change) => change.conflicted))
          return { status: "failed" as const, error: "Auto-sync could not resolve every file conflict." };
        if (snapshot.changes.length > 0) {
          const staged = await stageGitPaths(
            workspacePath,
            snapshot.changes.map((change) => change.path),
          );
          if (staged.status === "failed") return staged;
        }
        const committed = await commitGitChanges(
          workspacePath,
          "Combine local and remote note versions",
          hooksDirectory,
        );
        if (committed.status === "failed") return committed;
        localCommitCreated = true;
        return {
          status: "ready" as const,
          changedPaths,
          head: (await readGitSyncLocalState(workspacePath)).localRevision,
        };
      });
      if (merged.status === "failed") return merged;
      const pushed = await pushGitRemote(workspacePath, hooksDirectory, { ...options, expectedHead: merged.head });
      if (pushed.status === "failed") return pushed;
      return {
        ...pushed,
        action: "reconciled",
        changedPaths: [...new Map(merged.changedPaths.map((change) => [change.path, change])).values()],
      };
    } catch (error) {
      return { status: "failed", error: gitErrorMessage(error, "Git could not complete automatic synchronization.") };
    }
  };
  const result = await execute();
  return localCommitCreated ? { ...result, localCommitCreated } : result;
};

const commitIdentityConfiguration = async (workspacePath: string) => {
  try {
    await runGit(workspacePath, ["var", "GIT_AUTHOR_IDENT"]);
    return [] as string[];
  } catch {
    return ["-c", "user.name=Obim", "-c", "user.email=obim@localhost"];
  }
};

/** Initializes an empty local repository. Files remain unstaged until the user selects them. */
export const initializeGitRepository = async (workspacePath: string): Promise<GitRepositoryInitializationResult> => {
  const current = await readGitFileStatus(workspacePath);
  if (current.snapshot.status === "ready") {
    return { status: "succeeded", snapshot: current.snapshot };
  }
  if (current.snapshot.status === "unavailable") {
    return { status: "failed", error: current.snapshot.error };
  }

  try {
    await runGit(workspacePath, ["init", "--quiet"]);
  } catch {
    return { status: "failed", error: "Git could not initialize this workspace." };
  }

  const initialized = await readGitFileStatus(workspacePath);
  if (initialized.snapshot.status !== "ready") {
    return { status: "failed", error: "Git initialized, but the repository could not be read." };
  }
  return { status: "succeeded", snapshot: initialized.snapshot };
};
