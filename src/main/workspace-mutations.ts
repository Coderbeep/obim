import { randomUUID } from "crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { workspaceFileVersionsEqual, type WorkspaceFileVersion } from "@shared/file-item";
import type { WorkspaceFileSaveResult } from "@shared/file-operations";
import { toWorkspaceFileVersion } from "./workspace-files";

type WorkspaceFileContent = string | Uint8Array;

// ponytail: one application-wide mutation queue; split it only if workspace writes become a measured bottleneck.
let mutationTail = Promise.resolve();
let workspaceRevision = 0;
const mutationListeners = new Set<() => void>();

export const getWorkspaceRevision = () => workspaceRevision;

const queueWorkspaceOperation = <T>(operation: () => Promise<T>) => {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export const queueWorkspaceRead = <T>(operation: () => Promise<T>) => queueWorkspaceOperation(operation);

export const queueWorkspaceMutation = <T>(operation: () => Promise<T>) =>
  queueWorkspaceOperation(async () => {
    const result = await operation();
    workspaceRevision += 1;
    for (const listener of mutationListeners) listener();
    return result;
  });

/** Lets derived views invalidate state immediately after an application-owned workspace write. */
export const onWorkspaceMutation = (listener: () => void) => {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
};

export const getWorkspaceSnapshot = <T>(readSnapshot: () => Promise<T>) =>
  queueWorkspaceRead(async () => ({ revision: workspaceRevision, value: await readSnapshot() }));

const destinationExists = async (filePath: string) => {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

export const atomicWriteWorkspaceFile = async (
  filePath: string,
  content: WorkspaceFileContent,
  createParentDirectory: boolean,
  beforePublish?: () => Promise<void>,
) => {
  const directoryPath = path.dirname(filePath);
  if (createParentDirectory) await mkdir(directoryPath, { recursive: true });

  let targetHandle: Awaited<ReturnType<typeof open>> | undefined;
  let targetMode: number | undefined;
  try {
    targetHandle = await open(filePath, "r+");
    targetMode = (await targetHandle.stat()).mode;
  } catch (error) {
    if (!createParentDirectory || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    await targetHandle?.close();
  }

  const temporaryPath = path.join(directoryPath, `.obim-write-${randomUUID()}`);
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  let ownsTemporaryPath = false;
  try {
    fileHandle = await open(temporaryPath, "wx", targetMode);
    ownsTemporaryPath = true;
    await fileHandle.writeFile(content, typeof content === "string" ? "utf-8" : undefined);
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = undefined;
    await beforePublish?.();
    await rename(temporaryPath, filePath);
  } catch (error) {
    await fileHandle?.close().catch(() => undefined);
    if (ownsTemporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const getUniqueWorkspacePath = async (desiredPath: string) => {
  const extension = path.extname(desiredPath);
  const basePath = extension ? desiredPath.slice(0, -extension.length) : desiredPath;

  for (let index = 0; ; index += 1) {
    const candidatePath = index === 0 ? desiredPath : `${basePath} ${index}${extension}`;
    if (!(await destinationExists(candidatePath))) return candidatePath;
  }
};

export const moveWorkspaceItem = (sourcePath: string, destinationPath: string) =>
  queueWorkspaceMutation(async () => {
    if (await destinationExists(destinationPath)) {
      const source = path.resolve(sourcePath);
      const destination = path.resolve(destinationPath);
      const sourceName = path.basename(source);
      const destinationName = path.basename(destination);
      if (
        path.dirname(source) !== path.dirname(destination) ||
        sourceName === destinationName ||
        sourceName.toLowerCase() !== destinationName.toLowerCase()
      )
        return false;
      // Equal inode IDs alone also match distinct hard links. Verify the actual
      // directory spelling: only the original entry may exist under either case.
      const entries = await readdir(path.dirname(source));
      if (!entries.includes(sourceName) || entries.includes(destinationName)) return false;
      const [sourceStat, destinationStat] = await Promise.all([lstat(source), lstat(destination)]);
      if (sourceStat.dev !== destinationStat.dev || sourceStat.ino !== destinationStat.ino) return false;
      // Supported case-insensitive filesystems rename the same entry directly;
      // this avoids an intermediate path that could strand an open note.
    }
    await rename(sourcePath, destinationPath);
    return true;
  });

export const moveWorkspaceItemUniquely = (sourcePath: string, desiredDestinationPath: string) =>
  queueWorkspaceMutation(async () => {
    const destinationPath = await getUniqueWorkspacePath(desiredDestinationPath);
    await rename(sourcePath, destinationPath);
    return destinationPath;
  });

export const createWorkspaceFile = (filePath: string, content: WorkspaceFileContent) =>
  queueWorkspaceMutation(async () => {
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        content,
        typeof content === "string" ? { encoding: "utf-8", flag: "wx" } : { flag: "wx" },
      );
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  });

/** Creates a file under a unique collision-safe name in one workspace mutation. */
export const createWorkspaceFileUniquely = (desiredPath: string, content: WorkspaceFileContent) =>
  queueWorkspaceMutation(async () => {
    await mkdir(path.dirname(desiredPath), { recursive: true });
    const filePath = await getUniqueWorkspacePath(desiredPath);
    await writeFile(
      filePath,
      content,
      typeof content === "string" ? { encoding: "utf-8", flag: "wx" } : { flag: "wx" },
    );
    return filePath;
  });

/** Overwrites an existing file, but never recreates a path that was moved or deleted. */
export const overwriteWorkspaceFile = (filePath: string, content: WorkspaceFileContent) =>
  queueWorkspaceMutation(async () => {
    if (!(await destinationExists(filePath))) return false;
    try {
      await atomicWriteWorkspaceFile(filePath, content, false);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  });

class WorkspaceFileConflictError extends Error {}

const conflictResult = (): WorkspaceFileSaveResult => ({
  success: false,
  error: "File changed on disk before it could be saved",
  errorCode: "conflict",
});

const readWorkspaceFileVersion = async (filePath: string) => toWorkspaceFileVersion(await lstat(filePath));

/** Overwrites a file only when it still matches the version opened by the editor. */
export const overwriteWorkspaceFileIfVersion = (
  filePath: string,
  content: WorkspaceFileContent,
  expectedVersion: WorkspaceFileVersion,
  beforePublish?: () => Promise<void>,
) =>
  queueWorkspaceMutation(async (): Promise<WorkspaceFileSaveResult> => {
    try {
      await beforePublish?.();
      const currentVersion = await readWorkspaceFileVersion(filePath);
      if (!workspaceFileVersionsEqual(currentVersion, expectedVersion)) return conflictResult();

      await atomicWriteWorkspaceFile(filePath, content, false, async () => {
        await beforePublish?.();
        const latestVersion = await readWorkspaceFileVersion(filePath);
        if (!workspaceFileVersionsEqual(latestVersion, expectedVersion)) {
          throw new WorkspaceFileConflictError();
        }
      });

      return { success: true, version: await readWorkspaceFileVersion(filePath) };
    } catch (error) {
      if (error instanceof WorkspaceFileConflictError || (error as NodeJS.ErrnoException).code === "ENOENT") {
        return conflictResult();
      }
      throw error;
    }
  });

export type WorkspaceFileRestoreResult =
  | { success: true; created: boolean; recoveryPath?: string; version: WorkspaceFileVersion }
  | { success: false; error: string; errorCode: "conflict" };

const restoreConflictResult = (): WorkspaceFileRestoreResult => ({
  success: false,
  error: "The file changed before it could be restored.",
  errorCode: "conflict",
});

/**
 * Restores a file within the workspace mutation queue. Existing contents are
 * copied beside the note before the atomic replacement is published, so a
 * restore is recoverable even when the current editor buffer was just saved.
 */
export const restoreWorkspaceFileWithRecovery = (
  filePath: string,
  content: WorkspaceFileContent,
  expectedVersion?: WorkspaceFileVersion,
) =>
  queueWorkspaceMutation(async (): Promise<WorkspaceFileRestoreResult> => {
    let currentVersion: WorkspaceFileVersion | undefined;
    try {
      const currentStat = await lstat(filePath);
      if (!currentStat.isFile() || !expectedVersion) return restoreConflictResult();
      currentVersion = toWorkspaceFileVersion(currentStat);
      if (!workspaceFileVersionsEqual(currentVersion, expectedVersion)) return restoreConflictResult();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (expectedVersion) return restoreConflictResult();
    }

    if (!currentVersion) {
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(
          filePath,
          content,
          typeof content === "string" ? { encoding: "utf-8", flag: "wx" } : { flag: "wx" },
        );
        return { success: true, created: true, version: await readWorkspaceFileVersion(filePath) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return restoreConflictResult();
        throw error;
      }
    }

    const extension = path.extname(filePath);
    const basePath = extension ? filePath.slice(0, -extension.length) : filePath;
    const recoveryPath = await getUniqueWorkspacePath(`${basePath} — before restore${extension}`);
    const previousContent = await readFile(filePath);
    const verifiedVersion = expectedVersion;
    if (!verifiedVersion) return restoreConflictResult();
    await writeFile(recoveryPath, previousContent, { flag: "wx" });

    try {
      await atomicWriteWorkspaceFile(filePath, content, false, async () => {
        const latestVersion = await readWorkspaceFileVersion(filePath);
        if (!workspaceFileVersionsEqual(latestVersion, verifiedVersion)) throw new WorkspaceFileConflictError();
      });
    } catch (error) {
      if (error instanceof WorkspaceFileConflictError || (error as NodeJS.ErrnoException).code === "ENOENT") {
        await rm(recoveryPath, { force: true }).catch(() => undefined);
        return restoreConflictResult();
      }
      throw error;
    }

    return {
      success: true,
      created: false,
      recoveryPath,
      version: await readWorkspaceFileVersion(filePath),
    };
  });

/** Creates or overwrites application-owned metadata such as the task-board config. */
export const upsertWorkspaceFile = (filePath: string, content: WorkspaceFileContent) =>
  queueWorkspaceOperation(async () => {
    try {
      const current = await readFile(filePath);
      const next = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
      if (current.equals(next)) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await atomicWriteWorkspaceFile(filePath, content, true);
    return true;
  });

export const createWorkspaceDirectory = (directoryPath: string) =>
  queueWorkspaceMutation(async () => {
    try {
      await mkdir(directoryPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  });

export const trashWorkspaceItem = (filePath: string, trashItem: (path: string) => Promise<void>) =>
  queueWorkspaceMutation(async () => {
    await trashItem(filePath);
  });
