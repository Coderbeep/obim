import { link, lstat, mkdir, readdir, rename, rmdir, unlink } from "fs/promises";
import path from "path";
import type { ExplorerMovedRoot } from "@shared/explorer-pdf-notes";

type Stat = Awaited<ReturnType<typeof lstat>>;
type Entry = ExplorerMovedRoot & { version: Stat; children?: string[] };
type Published = Entry & { publishedVersion: Stat };

export class PartialWorkspaceMoveError extends AggregateError {
  public readonly paths: ExplorerMovedRoot[];
  constructor(errors: unknown[], paths: readonly ExplorerMovedRoot[]) {
    super(errors, "The move could not be fully restored. Refresh the explorer and check the reported paths.");
    this.paths = [
      ...paths,
      ...errors.flatMap((error) => (error instanceof PartialWorkspaceMoveError ? error.paths : [])),
    ];
  }
}

export const statIfPresent = async (filePath: string) => {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};
const sameEntry = (left: Stat, right: Stat) => left.dev === right.dev && left.ino === right.ino;
const unchangedFile = (left: Stat, right: Stat) =>
  sameEntry(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs;

/** A casing alias is allowed only when it is the same directory entry, never a distinct hard link. */
export const isCaseOnlyWorkspaceMove = async (source: string, destination: string) => {
  if (source === destination || path.dirname(source) !== path.dirname(destination)) return false;
  if (path.basename(source).toLowerCase() !== path.basename(destination).toLowerCase()) return false;
  const target = await statIfPresent(destination);
  if (!target) return false;
  const entries = await readdir(path.dirname(source));
  return (
    entries.includes(path.basename(source)) &&
    !entries.includes(path.basename(destination)) &&
    sameEntry(await lstat(source), target)
  );
};

/**
 * Moves without replacing any destination. Regular files are exclusively hard-linked
 * before source removal; directories reserve names with mkdir. Unsupported/cross-volume
 * links fail while sources still exist. The caller owns the workspace mutation queue.
 */
export const moveWorkspaceRootsExclusively = async (
  roots: readonly ExplorerMovedRoot[],
): Promise<() => Promise<void>> => {
  const entries: Entry[] = [];
  const casing: Entry[] = [];
  const scan = async (source: string, destination: string) => {
    const version = await lstat(source);
    if (!version.isFile() && !version.isDirectory()) throw new Error("Only regular files and directories can move.");
    const children = version.isDirectory() ? (await readdir(source)).sort() : undefined;
    entries.push({ source, destination, version, children });
    for (const name of children ?? []) await scan(path.join(source, name), path.join(destination, name));
  };
  for (const root of roots) {
    if (root.source === root.destination) continue;
    if (await isCaseOnlyWorkspaceMove(root.source, root.destination))
      casing.push({ ...root, version: await lstat(root.source) });
    else await scan(root.source, root.destination);
  }

  const published: Published[] = [];
  const renamed: Entry[] = [];
  try {
    for (const entry of casing) {
      if (!(await isCaseOnlyWorkspaceMove(entry.source, entry.destination)))
        throw new Error("Case-only destination changed before the move.");
      await rename(entry.source, entry.destination);
      renamed.push(entry);
    }
    // Finish publication before removing any source file. No overwriting rename is used.
    for (const entry of entries) {
      if (entry.version.isDirectory()) await mkdir(entry.destination, { mode: Number(entry.version.mode) });
      else await link(entry.source, entry.destination);
      published.push({ ...entry, publishedVersion: await lstat(entry.destination) });
    }
    for (const entry of entries) {
      const current = await lstat(entry.source);
      if (!sameEntry(current, entry.version)) throw new Error("A move source was replaced externally.");
      if (entry.children) {
        if (JSON.stringify((await readdir(entry.source)).sort()) !== JSON.stringify(entry.children))
          throw new Error("A move source directory changed externally.");
      } else if (!unchangedFile(current, entry.version)) throw new Error("A move source changed externally.");
    }
    for (const entry of entries.filter((entry) => entry.version.isFile())) {
      if (!unchangedFile(await lstat(entry.source), entry.version))
        throw new Error("A move source changed externally.");
      // A writer can replace a published link while the other root is being staged.
      // Retain the source unless the destination still holds that exact file.
      if (!sameEntry(await lstat(entry.destination), entry.version))
        throw new Error("A move destination was replaced externally.");
      await unlink(entry.source);
    }
    for (const entry of entries.filter((entry) => entry.version.isDirectory()).reverse()) {
      if (!sameEntry(await lstat(entry.source), entry.version))
        throw new Error("A move source directory was replaced.");
      await rmdir(entry.source);
    }
  } catch (error) {
    const failures: unknown[] = [];
    // Recreate absent source directories; existing entries always belong to their writer.
    for (const entry of published.filter((entry) => entry.version.isDirectory())) {
      try {
        if (!(await statIfPresent(entry.source))) await mkdir(entry.source, { mode: Number(entry.version.mode) });
      } catch (failure) {
        failures.push(failure);
      }
    }
    for (const entry of published.filter((entry) => entry.version.isFile())) {
      try {
        const destination = await statIfPresent(entry.destination);
        if (!destination || !sameEntry(destination, entry.publishedVersion))
          throw new Error(`Destination changed externally: ${entry.destination}`, { cause: error });
        const source = await statIfPresent(entry.source);
        if (!source) await link(entry.destination, entry.source);
        else if (!sameEntry(source, destination))
          throw new Error(`Source occupied externally: ${entry.source}`, { cause: error });
      } catch (failure) {
        failures.push(failure);
      }
    }
    for (const entry of [...published].reverse()) {
      try {
        const current = await statIfPresent(entry.destination);
        if (!current || !sameEntry(current, entry.publishedVersion))
          throw new Error(`Cannot clean an externally changed destination: ${entry.destination}`, { cause: error });
        if (current.isDirectory()) await rmdir(entry.destination);
        else {
          const source = await statIfPresent(entry.source);
          if (!source || !sameEntry(source, current))
            throw new Error(`Source was not restored: ${entry.source}`, { cause: error });
          await unlink(entry.destination);
        }
      } catch (failure) {
        failures.push(failure);
      }
    }
    for (const entry of [...renamed].reverse()) {
      try {
        if (
          !(await isCaseOnlyWorkspaceMove(entry.destination, entry.source)) ||
          !sameEntry(await lstat(entry.destination), entry.version)
        )
          throw new Error(`Cannot restore externally changed destination: ${entry.destination}`, { cause: error });
        await rename(entry.destination, entry.source);
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length) throw new PartialWorkspaceMoveError([error, ...failures], [...roots, ...entries]);
    throw error;
  }
  return async () => {
    await moveWorkspaceRootsExclusively(
      roots.map(({ source, destination }) => ({ source: destination, destination: source })),
    );
  };
};
