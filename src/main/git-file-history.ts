import { GitProcessError as GitHistoryProcessError, runGit as runSafeGit } from "./git-command";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

import type {
  GitFileHistoryChangeKind,
  GitFileHistoryEntry,
  GitFileHistoryPage,
  GitFileRestoreRequest,
  GitFileRestoreResult,
  GitFileRevisionRequest,
  GitFileRevisionResult,
} from "@shared/git";
import { GIT_FILE_HISTORY_PAGE_SIZE } from "@shared/git";
import { MAX_FULL_TEXT_EDITOR_BYTES } from "@shared/large-files";
import { restoreWorkspaceFileWithRecovery } from "./workspace-mutations";
import { resolveWorkspacePath } from "./workspace-paths";

const GIT_HISTORY_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;
const GIT_RESTORE_BLOB_LIMIT_BYTES = 50 * 1024 * 1024;
const MAX_COMMIT_SUBJECT_LENGTH = 1_000;
const MAX_AUTHOR_LENGTH = 256;
const MAX_HISTORY_OFFSET = 100_000;
const REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const restoreTokenSecret = randomBytes(32);

const createRestoreToken = (filePath: string, pathAtRevision: string, revisionId: string) =>
  createHmac("sha256", restoreTokenSecret)
    .update(JSON.stringify([filePath, pathAtRevision, revisionId]))
    .digest("base64url");

const restoreTokenMatches = (actual: string, expected: string) => {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

const runGit = (cwd: string, args: string[], outputLimitBytes = GIT_HISTORY_OUTPUT_LIMIT_BYTES) =>
  runSafeGit(cwd, args, { outputLimitBytes });

type GitRepositoryContext = {
  canonicalWorkspacePath: string;
  repositoryRoot: string;
  repositoryScope: "workspace" | "ancestor";
  scopePrefix: string;
  workspacePath: string;
};

const toGitPath = (value: string) => value.split(path.sep).join("/");

const resolveRepositoryContext = async (workspacePath: string): Promise<GitRepositoryContext> => {
  const [repositoryRootValue, insideWorkTree] = await Promise.all([
    runGit(workspacePath, ["rev-parse", "--show-toplevel"]),
    runGit(workspacePath, ["rev-parse", "--is-inside-work-tree"]),
  ]);
  if (insideWorkTree.toString("utf8").trim() !== "true") {
    throw new Error("This Git repository has no working tree.");
  }

  const [repositoryRoot, canonicalWorkspacePath] = await Promise.all([
    realpath(repositoryRootValue.toString("utf8").trim()),
    realpath(workspacePath),
  ]);
  const relativeWorkspace = path.relative(repositoryRoot, canonicalWorkspacePath);
  const outside =
    relativeWorkspace === ".." || relativeWorkspace.startsWith(`..${path.sep}`) || path.isAbsolute(relativeWorkspace);
  if (outside) throw new Error("The workspace is outside the detected repository.");

  const scopePrefix = toGitPath(relativeWorkspace);
  return {
    canonicalWorkspacePath,
    repositoryRoot,
    repositoryScope: scopePrefix ? "ancestor" : "workspace",
    scopePrefix,
    workspacePath: path.resolve(workspacePath),
  };
};

const isNotRepositoryError = (error: unknown) =>
  error instanceof GitHistoryProcessError &&
  error.exitCode === 128 &&
  error.message.toLowerCase().includes("not a git repository");

const isUnbornRepositoryError = (error: unknown) => {
  if (!(error instanceof GitHistoryProcessError) || error.exitCode !== 128) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("does not have any commits yet") ||
    message.includes("unknown revision") ||
    message.includes("ambiguous argument 'head'")
  );
};

const workspaceRelativePath = (gitPath: string, scopePrefix: string) => {
  if (!scopePrefix) return gitPath;
  if (gitPath === scopePrefix) return "";
  return gitPath.startsWith(`${scopePrefix}/`) ? gitPath.slice(scopePrefix.length + 1) : null;
};

const repositoryPathForWorkspacePath = (
  context: GitRepositoryContext,
  requestedPath: string,
): { repositoryPath: string; workspaceRelativePath: string } => {
  const resolvedPath = resolveWorkspacePath(context.workspacePath, requestedPath);
  const workspaceRelative = toGitPath(path.relative(context.workspacePath, resolvedPath));
  const canonicalResolvedPath = path.resolve(context.canonicalWorkspacePath, workspaceRelative);
  const repositoryPath = toGitPath(path.relative(context.repositoryRoot, canonicalResolvedPath));
  if (!workspaceRelative || !repositoryPath || repositoryPath.startsWith("../")) {
    throw new Error("Select a file inside the workspace.");
  }
  return { repositoryPath, workspaceRelativePath: workspaceRelative };
};

const normalizeHistoryCursor = (cursor?: string) => {
  if (!cursor) return 0;
  const match = /^offset:(\d+)$/u.exec(cursor);
  const offset = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_HISTORY_OFFSET) {
    throw new Error("The history cursor is invalid.");
  }
  return offset;
};

const changeKindForStatus = (status: string): GitFileHistoryChangeKind => {
  if (status.startsWith("A")) return "added";
  if (status.startsWith("D")) return "deleted";
  if (status.startsWith("R") || status.startsWith("C")) return "renamed";
  return "modified";
};

type ParsedNameStatus = { status: string; paths: string[] };

const parseHistoryLog = (output: Buffer, scopePrefix: string, targetWorkspacePath: string): GitFileHistoryEntry[] => {
  const fields = output.toString("utf8").split("\0");
  const entries: GitFileHistoryEntry[] = [];
  let index = 0;

  while (index < fields.length) {
    const revisionId = fields[index++]?.replace(/^\n+/u, "") ?? "";
    if (!revisionId) continue;
    if (!REVISION_PATTERN.test(revisionId) || index + 2 >= fields.length) break;

    const committedAtSeconds = Number(fields[index++]);
    const author = (fields[index++] ?? "").slice(0, MAX_AUTHOR_LENGTH).trim();
    const subject = (fields[index++] ?? "").slice(0, MAX_COMMIT_SUBJECT_LENGTH).trim() || "Commit";
    const nameStatuses: ParsedNameStatus[] = [];

    while (index < fields.length) {
      const status = fields[index]?.replace(/^\n+/u, "") ?? "";
      if (!status) {
        index += 1;
        break;
      }
      if (!/^[A-Z?][0-9]*$/u.test(status)) break;
      index += 1;
      const pathCount = status.startsWith("R") || status.startsWith("C") ? 2 : 1;
      const paths = fields.slice(index, index + pathCount);
      index += pathCount;
      if (paths.length === pathCount) nameStatuses.push({ status, paths });
    }

    const change = nameStatuses[0];
    if (!change || !Number.isFinite(committedAtSeconds)) continue;
    const pathAtRevisionValue = change.paths.at(-1) ?? "";
    const scopedPath = workspaceRelativePath(pathAtRevisionValue, scopePrefix);
    if (scopedPath === null || !scopedPath) continue;
    const previousPathValue = change.paths.length > 1 ? workspaceRelativePath(change.paths[0], scopePrefix) : null;

    entries.push({
      ...(author ? { author } : {}),
      changeKind: changeKindForStatus(change.status),
      committedAt: committedAtSeconds * 1_000,
      pathAtRevision: scopedPath,
      ...(previousPathValue ? { previousPath: previousPathValue } : {}),
      revisionId,
      restoreToken: createRestoreToken(targetWorkspacePath, scopedPath, revisionId),
      subject,
    });
  }

  return entries;
};

export const readGitFileHistory = async (
  workspacePath: string,
  filePath: string,
  cursor?: string,
  requestedLimit = GIT_FILE_HISTORY_PAGE_SIZE,
): Promise<GitFileHistoryPage> => {
  try {
    const context = await resolveRepositoryContext(workspacePath);
    const { repositoryPath, workspaceRelativePath: targetWorkspacePath } = repositoryPathForWorkspacePath(
      context,
      filePath,
    );
    const offset = normalizeHistoryCursor(cursor);
    const limit = Math.max(1, Math.min(GIT_FILE_HISTORY_PAGE_SIZE, Math.trunc(requestedLimit)));
    const output = await runGit(context.repositoryRoot, [
      "log",
      "--follow",
      "-z",
      `--max-count=${offset + limit + 1}`,
      "--format=format:%H%x00%ct%x00%an%x00%s%x00",
      "--name-status",
      "HEAD",
      "--",
      repositoryPath,
    ]);
    const parsed = parseHistoryLog(output, context.scopePrefix, targetWorkspacePath);
    const entries = parsed.slice(offset, offset + limit);
    if (entries.length === 0 && offset === 0) {
      return { status: "no-history", entries: [], repositoryScope: context.repositoryScope };
    }
    return {
      status: "ready",
      entries,
      ...(parsed.length > offset + limit ? { nextCursor: `offset:${offset + limit}` } : {}),
      repositoryScope: context.repositoryScope,
    };
  } catch (error) {
    if (isNotRepositoryError(error)) return { status: "not-repository", entries: [] };
    if (isUnbornRepositoryError(error)) {
      try {
        const context = await resolveRepositoryContext(workspacePath);
        return { status: "no-history", entries: [], repositoryScope: context.repositoryScope };
      } catch {
        return { status: "no-history", entries: [], repositoryScope: "workspace" };
      }
    }
    if (error instanceof GitHistoryProcessError && error.reason === "spawn") {
      return { status: "unavailable", entries: [], error: "Git is not installed or cannot be found." };
    }
    return {
      status: "unavailable",
      entries: [],
      error: error instanceof Error && error.message ? error.message : "File history is unavailable.",
    };
  }
};

type HistoricalBlobResult =
  | { status: "ready"; content: Buffer; revisionId: string; sizeBytes: number }
  | { status: "deleted"; revisionId: string }
  | { status: "too-large"; revisionId: string; sizeBytes: number };

const validateRevision = (revisionId: string) => {
  if (!REVISION_PATTERN.test(revisionId)) throw new Error("The selected revision is invalid.");
  return revisionId;
};

const readHistoricalBlob = async (
  context: GitRepositoryContext,
  request: GitFileRevisionRequest,
  maximumBytes: number,
): Promise<HistoricalBlobResult> => {
  const revisionId = validateRevision(request.revisionId);
  const currentPath = repositoryPathForWorkspacePath(context, request.filePath);
  const historicalPath = repositoryPathForWorkspacePath(context, request.pathAtRevision);
  if (!workspaceRelativePath(currentPath.repositoryPath, context.scopePrefix)) {
    throw new Error("The selected file is outside the workspace scope.");
  }
  const expectedToken = createRestoreToken(
    currentPath.workspaceRelativePath,
    historicalPath.workspaceRelativePath,
    revisionId,
  );
  if (!request.restoreToken || !restoreTokenMatches(request.restoreToken, expectedToken)) {
    throw new Error("The selected version is no longer valid. Refresh version history and try again.");
  }

  const treeEntry = await runGit(context.repositoryRoot, [
    "ls-tree",
    "-z",
    revisionId,
    "--",
    historicalPath.repositoryPath,
  ]);
  if (treeEntry.length === 0) return { status: "deleted", revisionId };

  const match = /^\d+ blob ([0-9a-f]{40}|[0-9a-f]{64})\t/u.exec(treeEntry.toString("utf8"));
  if (!match) throw new Error("The selected historical file is unavailable.");
  const blobId = match[1];
  const sizeBytes = Number((await runGit(context.repositoryRoot, ["cat-file", "-s", blobId])).toString("utf8").trim());
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) throw new Error("The historical file size is invalid.");
  if (sizeBytes > maximumBytes) return { status: "too-large", revisionId, sizeBytes };

  const content = await runGit(context.repositoryRoot, ["cat-file", "blob", blobId], maximumBytes + 1_024);
  return { status: "ready", content, revisionId, sizeBytes };
};

const decodeText = (content: Buffer) => {
  if (content.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return null;
  }
};

export const readGitFileRevision = async (
  workspacePath: string,
  request: GitFileRevisionRequest,
): Promise<GitFileRevisionResult> => {
  try {
    const context = await resolveRepositoryContext(workspacePath);
    const result = await readHistoricalBlob(context, request, MAX_FULL_TEXT_EDITOR_BYTES);
    if (result.status !== "ready") return result;
    const content = decodeText(result.content);
    return content === null
      ? { status: "binary", revisionId: result.revisionId, sizeBytes: result.sizeBytes }
      : {
          status: "ready",
          content,
          revisionId: result.revisionId,
          sizeBytes: result.sizeBytes,
        };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error && error.message ? error.message : "The historical file is unavailable.",
    };
  }
};

export const restoreGitFileRevision = async (
  workspacePath: string,
  request: GitFileRestoreRequest,
): Promise<GitFileRestoreResult> => {
  try {
    const context = await resolveRepositoryContext(workspacePath);
    if (context.repositoryScope !== "workspace") {
      return {
        status: "failed",
        error: "Restore is disabled because this workspace is inside a parent repository.",
      };
    }

    const targetPath = resolveWorkspacePath(context.workspacePath, request.filePath);
    const blob = await readHistoricalBlob(context, request, GIT_RESTORE_BLOB_LIMIT_BYTES);
    if (blob.status === "deleted") return { status: "failed", error: "That revision does not contain this file." };
    if (blob.status === "too-large") {
      return { status: "failed", error: "The historical file is too large to restore inside the application." };
    }

    const restored = await restoreWorkspaceFileWithRecovery(targetPath, blob.content, request.expectedVersion);
    if (!restored.success) return { status: "failed", error: restored.error, errorCode: restored.errorCode };

    const text = decodeText(blob.content);
    return {
      status: "succeeded",
      ...(text === null ? {} : { content: text }),
      created: restored.created,
      ...(restored.recoveryPath ? { recoveryPath: restored.recoveryPath } : {}),
      version: restored.version,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error && error.message ? error.message : "The historical file could not be restored.",
    };
  }
};
