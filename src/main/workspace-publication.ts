import { constants } from "node:fs";
import { copyFile, link, lstat, mkdir, readdir, rmdir, unlink } from "fs/promises";
import path from "node:path";

type PublishedEntry = { path: string; version: Awaited<ReturnType<typeof lstat>> };
const isCollision = (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST";

const linkOrCopyExclusive = async (source: string, destination: string) => {
  try {
    // Staging and destination normally share a volume: link creates the complete
    // file under its new name atomically, failing if any entry is already there.
    await link(source, destination);
  } catch (error) {
    if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw error;
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
};

const remember = async (entries: PublishedEntry[], destination: string) => {
  entries.push({ path: destination, version: await lstat(destination) });
};

const populateDirectory = async (source: string, destination: string, entries: PublishedEntry[]) => {
  for (const name of await readdir(source)) {
    const from = path.join(source, name);
    const to = path.join(destination, name);
    const version = await lstat(from);
    if (version.isDirectory()) {
      await mkdir(to, { mode: version.mode });
      await remember(entries, to);
      await populateDirectory(from, to, entries);
    } else if (version.isFile()) {
      await linkOrCopyExclusive(from, to);
      await remember(entries, to);
    } else {
      throw new Error("Only regular files and directories can be published.");
    }
  }
};

const cleanOwnedEntries = async (entries: PublishedEntry[]) => {
  for (const entry of entries.reverse()) {
    try {
      const current = await lstat(entry.path);
      if (current.dev !== entry.version.dev || current.ino !== entry.version.ino) continue;
      if (current.isDirectory()) {
        // Never recursively remove a destination: another program may have added data.
        await rmdir(entry.path);
      } else if (
        current.size === entry.version.size &&
        current.mtimeMs === entry.version.mtimeMs &&
        current.ctimeMs === entry.version.ctimeMs
      ) {
        await unlink(entry.path);
      }
    } catch {
      // Modified entries/nonempty directories belong to the external writer now.
    }
  }
};

/**
 * Publishes without replacement. Files use atomic exclusive links (or exclusive
 * copy on filesystems without links). Directories use exclusive mkdir reservation
 * followed by exclusive child publication; Node has no portable no-replace
 * directory rename. A directory can be visible while its children are published.
 */
export const publishStagedWorkspaceItem = async (source: string, desired: string, firstCollisionNumber = 1) => {
  const version = await lstat(source);
  if (!version.isFile() && !version.isDirectory())
    throw new Error("Publication source must be a regular file or directory.");
  const extension = path.extname(desired);
  const base = extension ? desired.slice(0, -extension.length) : desired;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const destination = attempt === 0 ? desired : `${base} ${attempt + firstCollisionNumber - 1}${extension}`;
    try {
      if (version.isFile()) await linkOrCopyExclusive(source, destination);
      else await mkdir(destination, { mode: version.mode });
    } catch (error) {
      if (isCollision(error)) continue;
      throw error;
    }
    if (version.isFile()) return destination;
    const entries: PublishedEntry[] = [];
    try {
      await remember(entries, destination);
      await populateDirectory(source, destination, entries);
      return destination;
    } catch (error) {
      await cleanOwnedEntries(entries);
      throw new Error(
        `Could not finish publishing ${destination}. Any externally changed entries were preserved. ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  throw new Error("Could not choose an unused destination after repeated collisions.");
};
