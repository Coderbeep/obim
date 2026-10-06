import { lstat, readFile, readdir, rename } from "fs/promises";
import path from "path";
import { rewriteNoteLinksWithCount } from "@shared/note-link-updates";
import type { NoteLinkUpdate } from "@shared/file-operations";
import { atomicWriteWorkspaceFile, getUniqueWorkspacePath, queueWorkspaceMutation } from "./workspace-mutations";
import { readWorkspaceTextFile } from "./workspace-files";

export class RestoredLinkMoveError extends Error {
  constructor(
    cause: unknown,
    public readonly linkUpdates: NoteLinkUpdate[],
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

const collectNotes = async (root: string): Promise<string[]> => {
  const paths: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      // Match the explorer's hidden-directory and symlink exclusions.
      if (entry.isDirectory() && !entry.name.startsWith(".")) await visit(fullPath);
      else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) paths.push(fullPath);
    }
  };
  await visit(root);
  return paths.sort();
};

/** Moves and repairs links in one mutation queue entry, restoring prior files if a write fails. */
export const moveWorkspaceItemWithLinks = (root: string, source: string, requested: string, unique = false) =>
  queueWorkspaceMutation(async () => {
    const destination = unique ? await getUniqueWorkspacePath(requested) : requested;
    const destinationAvailable = async () => {
      try {
        await lstat(destination);
        const entries = await readdir(path.dirname(source));
        return (
          path.dirname(source) === path.dirname(destination) &&
          path.basename(source).toLowerCase() === path.basename(destination).toLowerCase() &&
          entries.includes(path.basename(source)) &&
          !entries.includes(path.basename(destination))
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
        throw error;
      }
    };
    if (source === destination) {
      await lstat(source);
      return { output: destination, linkUpdates: [] };
    }
    if (!(await destinationAvailable())) return null;
    const before = await collectNotes(root);
    const remap = (file: string) =>
      file === source || file.startsWith(`${source}${path.sep}`) ? destination + file.slice(source.length) : file;
    const after = before.map(remap);
    const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
    const beforePaths = before.map(relative);
    const afterPaths = after.map(relative);
    let updatedLinkCount = 0;
    const changes: { beforePath: string; path: string; previousContent: string; content: string }[] = [];
    for (let index = 0; index < before.length; index++) {
      const previousContent = await readFile(before[index], "utf8");
      const { content, count } = rewriteNoteLinksWithCount(previousContent, {
        beforePaths,
        afterPaths,
        sourceBefore: beforePaths[index],
        sourceAfter: afterPaths[index],
      });
      updatedLinkCount += count;
      if (content !== previousContent)
        changes.push({ beforePath: before[index], path: after[index], previousContent, content });
    }
    // Abort before moving if an external editor has changed a snapshot used for a rewrite.
    for (const change of changes) {
      if ((await readFile(change.beforePath, "utf8")) !== change.previousContent)
        throw new Error("A linked note changed on disk. Try the operation again.");
    }
    if (!(await destinationAvailable()))
      throw new Error("Destination file appeared while updating links. Try the operation again.");
    const written: typeof changes = [];
    await rename(source, destination);
    try {
      for (const change of changes) {
        await atomicWriteWorkspaceFile(change.path, change.content, false, async () => {
          if ((await readFile(change.path, "utf8")) !== change.previousContent)
            throw new Error("A linked note changed on disk. Try the operation again.");
        });
        written.push(change);
      }
      const linkUpdates: NoteLinkUpdate[] = await Promise.all(
        changes.map(async (change) => {
          const snapshot = await readWorkspaceTextFile(change.path);
          if (snapshot.content !== change.content)
            throw new Error("A linked note changed on disk. Try the operation again.");
          return {
            path: change.path.split(path.sep).join("/"),
            previousContent: change.previousContent,
            content: change.content,
            version: snapshot.version,
          };
        }),
      );
      return { output: destination, linkUpdates, updatedLinkCount, linkMove: { beforePaths, afterPaths } };
    } catch (error) {
      const failures: unknown[] = [];
      for (const change of written.reverse()) {
        try {
          await atomicWriteWorkspaceFile(change.path, change.previousContent, false, async () => {
            if ((await readFile(change.path, "utf8")) !== change.content)
              throw new Error(`Cannot restore externally changed note: ${change.path}`);
          });
        } catch (rollbackError) {
          failures.push(rollbackError);
        }
      }
      try {
        await rename(destination, source);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
      if (failures.length)
        throw new AggregateError(
          [error, ...failures],
          "Link update failed and could not be fully restored. Check the affected notes.",
          { cause: error },
        );
      // Atomic restoration replaces inodes too; refresh open buffers' save versions.
      const restored = await Promise.all(
        written.map(async (change): Promise<NoteLinkUpdate> => {
          const snapshot = await readWorkspaceTextFile(change.beforePath);
          return {
            path: change.beforePath.split(path.sep).join("/"),
            previousContent: change.previousContent,
            content: snapshot.content,
            version: snapshot.version,
          };
        }),
      );
      throw new RestoredLinkMoveError(error, restored);
    }
  });
