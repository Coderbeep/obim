import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/** Reads only committed snapshots; abandoned temporary writes are never candidates. */
export const readConfiguration = <T extends object>(filePath: string): T => {
  const read = (candidate: string): T => {
    const value: unknown = JSON.parse(readFileSync(candidate, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid configuration object");
    return value as T;
  };
  try {
    return read(filePath);
  } catch (primaryError) {
    try {
      return read(`${filePath}.bak`);
    } catch (backupError) {
      if (missing(primaryError) && missing(backupError)) return {} as T;
      throw new AggregateError(
        [primaryError, backupError],
        "The saved configuration and its recovery copy cannot be read. They have been preserved for recovery.",
        { cause: backupError },
      );
    }
  }
};

const replaceConfiguration = async (filePath: string, content: string) => {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(content, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

/** The queue owns the read, mutation and publication, including recovery-copy updates. */
let mutationQueue: Promise<unknown> = Promise.resolve();
export const mutateConfiguration = <T extends object, R>(filePath: string, mutate: (config: T) => R): Promise<R> => {
  const operation = mutationQueue.then(async () => {
    const config = readConfiguration<T>(filePath);
    const previousContent = JSON.stringify(config, null, 2);
    const result = mutate(config);
    await replaceConfiguration(`${filePath}.bak`, previousContent);
    await replaceConfiguration(filePath, JSON.stringify(config, null, 2));
    // Directory fsync is supported by Unix; Windows does not allow opening directories.
    if (process.platform !== "win32") {
      const directory = await open(path.dirname(filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return result;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
};
