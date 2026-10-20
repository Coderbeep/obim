import { lstat, mkdir, readdir, rmdir, writeFile } from "fs/promises";
import path from "path";
import {
  PDF_NOTES_SUFFIX,
  getPdfNotesGroups,
  type ExplorerSnapshot,
  type CreatePdfNoteResult,
  type MovePdfNotesResult,
  type ExplorerMovedRoot,
  type ExplorerOperationFailure,
} from "@shared/explorer-pdf-notes";
import { isMarkdownFile, isPdfFile } from "@shared/mime-types";
import { isValidFilename } from "@shared/pathUtils";
import { isIgnoredWorkspaceEntry } from "@shared/workspace-entry";
import { runExternalFileImport, type FileImportSource, type ExternalFileImportResult } from "./file-import";
import { getWorkspaceFileTree, toFileItem, toRendererPath } from "./workspace-files";
import {
  getWorkspaceRevision,
  getWorkspaceSnapshot,
  getUniqueWorkspacePath,
  queueWorkspaceMutation,
} from "./workspace-mutations";
import { resolveWorkspacePath } from "./workspace-paths";
import { RestoredLinkMoveError, runLinkedWorkspaceMove } from "./workspace-linked-move";
import {
  isCaseOnlyWorkspaceMove,
  moveWorkspaceRootsExclusively,
  PartialWorkspaceMoveError,
  statIfPresent,
} from "./workspace-exclusive-move";

/** One queued physical read supplies both the raw tree and its explorer relationships. */
export const getExplorerSnapshot = async (workspacePath: string): Promise<ExplorerSnapshot> => {
  const snapshot = await getWorkspaceSnapshot(async () => {
    const root = resolveWorkspacePath(workspacePath, ".");
    for (let attempt = 0; ; attempt++) {
      try {
        const items = await getWorkspaceFileTree(root, root);
        return { items, pdfNotesGroups: getPdfNotesGroups(items) };
      } catch (error) {
        if (attempt >= 2 || !["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
    }
  });
  return { revision: snapshot.revision, ...snapshot.value };
};

class ExplorerConflictError extends Error {}
const objectRequest = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid PDF notes request.");
  return value as Record<string, unknown>;
};
const stringValue = (value: unknown) => {
  if (typeof value !== "string" || !value) throw new TypeError("A workspace path or filename is required.");
  return value;
};
const workspacePath = (root: string, value: unknown, directory = false) => {
  const resolved = resolveWorkspacePath(root, stringValue(value));
  const parts = path.relative(root, resolved).split(path.sep);
  const parents = directory ? parts : parts.slice(0, -1);
  if (parents.some((part) => part.startsWith("."))) throw new Error("Hidden workspace directories are not supported.");
  return resolved;
};
const requireExactEntry = async (root: string, filePath: string) => {
  let parent = path.resolve(root);
  for (const segment of path.relative(root, filePath).split(path.sep).filter(Boolean)) {
    if (!(await readdir(parent)).includes(segment))
      throw new Error("The requested path casing does not match its directory entry.");
    parent = path.join(parent, segment);
  }
};
const requirePdf = async (root: string, value: unknown) => {
  const pdf = workspacePath(root, value);
  if (!isPdfFile(null, pdf) || !(await lstat(pdf)).isFile()) throw new Error("Select a regular PDF file.");
  await requireExactEntry(root, pdf);
  return pdf;
};
const companionPath = (root: string, pdf: string) => resolveWorkspacePath(root, `${pdf}${PDF_NOTES_SUFFIX}`);
const existingCompanion = async (root: string, pdf: string) => {
  const directory = companionPath(root, pdf);
  const stat = await statIfPresent(directory);
  if (stat && (!stat.isDirectory() || !(await readdir(path.dirname(directory))).includes(path.basename(directory))))
    throw new ExplorerConflictError("The companion path is occupied by another entry.");
  return { directory, exists: !!stat };
};
const ensureCompanion = async (root: string, pdf: string) => {
  const { directory, exists } = await existingCompanion(root, pdf);
  if (!exists) {
    try {
      await mkdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await requirePdf(root, pdf);
  await existingCompanion(root, pdf);
  return directory;
};
const existsForRecovery = async (filePath: string): Promise<boolean | null> => {
  try {
    return !!(await statIfPresent(filePath));
  } catch {
    return null;
  }
};
const mutation = async <T extends { success: true }>(operation: () => Promise<T>) =>
  queueWorkspaceMutation(async (): Promise<(T | ExplorerOperationFailure) & { revision: number }> => {
    try {
      return { ...(await operation()), revision: getWorkspaceRevision() + 1 };
    } catch (error) {
      const failure: ExplorerOperationFailure = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof RestoredLinkMoveError) failure.linkUpdates = error.linkUpdates;
      if (error instanceof ExplorerConflictError || (error as NodeJS.ErrnoException).code === "EEXIST")
        failure.errorCode = "conflict";
      if (error instanceof PartialWorkspaceMoveError) {
        failure.errorCode = "partial";
        const paths = new Map(error.paths.map((entry) => [entry.source, entry]));
        failure.recoveryPaths = await Promise.all(
          [...paths.values()].map(async ({ source, destination }) => ({
            source: toRendererPath(source),
            destination: toRendererPath(destination),
            sourceExists: await existsForRecovery(source),
            destinationExists: await existsForRecovery(destination),
          })),
        );
      }
      // Even a failed operation can have created a companion or restored a file's inode.
      return { ...failure, revision: getWorkspaceRevision() + 1 };
    }
  });

export const createPdfNote = (root: string, value: unknown): Promise<CreatePdfNoteResult> =>
  mutation(async () => {
    const request = objectRequest(value);
    const filename = stringValue(request.filename);
    if (!isValidFilename(filename) || !isMarkdownFile(null, filename))
      throw new TypeError("Use a portable Markdown filename.");
    if (typeof request.content !== "string") throw new TypeError("Note content must be Markdown text.");
    const pdf = await requirePdf(root, request.pdfPath);
    const directory = await ensureCompanion(root, pdf);
    const filePath = resolveWorkspacePath(root, path.join(directory, filename));
    await writeFile(filePath, request.content, { encoding: "utf8", flag: "wx" });
    return { success: true as const, file: toFileItem(filePath, await lstat(filePath), root) };
  });

const moveResult = async (root: string, movedRoots: ExplorerMovedRoot[], reserveCompanion?: string) => {
  const moved = await runLinkedWorkspaceMove(root, movedRoots, async () => {
    // Reserve even an absent companion, so a file-only move cannot adopt a racing folder.
    if (!reserveCompanion) return moveWorkspaceRootsExclusively(movedRoots);
    await mkdir(reserveCompanion);
    const reservation = await lstat(reserveCompanion);
    const release = async () => {
      const current = await lstat(reserveCompanion);
      if (current.dev !== reservation.dev || current.ino !== reservation.ino)
        throw new Error(`Companion reservation changed externally: ${reserveCompanion}`);
      await rmdir(reserveCompanion);
    };
    let undo: (() => Promise<void>) | undefined;
    try {
      undo = await moveWorkspaceRootsExclusively(movedRoots);
      await release();
      return undo;
    } catch (error) {
      const failures: unknown[] = [];
      try {
        await undo?.();
      } catch (failure) {
        failures.push(failure);
      }
      try {
        await release();
      } catch (failure) {
        failures.push(failure);
      }
      if (failures.length)
        throw new PartialWorkspaceMoveError(
          [error, ...failures],
          [...movedRoots, { source: `${movedRoots[0].source}${PDF_NOTES_SUFFIX}`, destination: reserveCompanion }],
        );
      throw error;
    }
  });
  return {
    success: true as const,
    ...moved,
    output: toRendererPath(moved.output),
    movedRoots: movedRoots.map(({ source, destination }) => ({
      source: toRendererPath(source),
      destination: toRendererPath(destination),
    })),
  };
};

export const attachPdfNote = (root: string, value: unknown): Promise<MovePdfNotesResult> =>
  mutation(async () => {
    const request = objectRequest(value);
    const pdf = await requirePdf(root, request.pdfPath);
    const source = workspacePath(root, request.notePath);
    if (!isMarkdownFile(null, source) || !(await lstat(source)).isFile())
      throw new Error("Select a regular Markdown note.");
    if (!isValidFilename(path.basename(source))) throw new TypeError("Use a portable Markdown filename.");
    await requireExactEntry(root, source);
    const directory = await ensureCompanion(root, pdf);
    const desired = path.join(directory, path.basename(source));
    const destination = source === desired ? source : await getUniqueWorkspacePath(desired);
    return moveResult(root, [{ source, destination }]);
  });

/** OS drops copy ordinary Markdown files; validate before lazily creating a companion. */
export const importPdfNotes = (root: string, value: unknown): Promise<ExternalFileImportResult> =>
  queueWorkspaceMutation(async () => {
    try {
      const request = objectRequest(value);
      const pdf = await requirePdf(root, request.pdfPath);
      if (!Array.isArray(request.sources) || !request.sources.length)
        throw new Error("Drop Markdown notes onto the PDF.");
      for (const value of request.sources) {
        const source = objectRequest(value);
        const name = source.kind === "path" ? path.basename(stringValue(source.path)) : stringValue(source.name);
        if (!isMarkdownFile(null, name) || !isValidFilename(name) || isIgnoredWorkspaceEntry(name))
          throw new Error("Only Markdown notes can be attached to a PDF.");
        if (source.kind === "path") {
          const sourcePath = stringValue(source.path);
          if (!path.isAbsolute(sourcePath) || !(await lstat(sourcePath)).isFile())
            throw new Error("Select regular Markdown files.");
        } else if (source.kind !== "buffer" || !(source.content instanceof Uint8Array)) {
          throw new Error("Import sources are invalid.");
        }
      }
      const directory = await ensureCompanion(root, pdf);
      return await runExternalFileImport(request.sources as FileImportSource[], directory);
    } catch (error) {
      return { importedPaths: [], errors: [error instanceof Error ? error.message : String(error)] };
    }
  });

export const movePdfWithNotes = (root: string, value: unknown): Promise<MovePdfNotesResult> =>
  mutation(async () => {
    const request = objectRequest(value);
    const source = await requirePdf(root, request.pdfPath);
    const directory = workspacePath(root, request.destinationDirectoryPath, true);
    if (!(await lstat(directory)).isDirectory()) throw new Error("The move destination must be a directory.");
    await requireExactEntry(root, directory);
    const explicitName = request.newFilename !== undefined;
    const filename = explicitName ? stringValue(request.newFilename) : path.basename(source);
    if (!isValidFilename(filename) || !isPdfFile(null, filename)) throw new TypeError("Use a portable PDF filename.");
    const companion = await existingCompanion(root, source);
    if (directory === companion.directory || directory.startsWith(`${companion.directory}${path.sep}`))
      throw new Error("A PDF cannot move into its own notes directory.");
    const available = async (from: string, to: string) =>
      from === to || !(await statIfPresent(to)) || (await isCaseOnlyWorkspaceMove(from, to));
    let destination = path.join(directory, filename);
    let targetCompanion = companionPath(root, destination);
    for (let number = 0; ; number++) {
      if (
        (await available(source, destination)) &&
        (await available(companion.exists ? companion.directory : "", targetCompanion))
      )
        break;
      if (explicitName || number >= 999)
        throw new ExplorerConflictError("The PDF or companion destination already exists.");
      const extension = path.extname(filename);
      destination = path.join(directory, `${filename.slice(0, -extension.length)} ${number + 1}${extension}`);
      targetCompanion = companionPath(root, destination);
    }
    const roots = [{ source, destination }];
    if (companion.exists) roots.push({ source: companion.directory, destination: targetCompanion });
    // Check the absent companion again immediately before publication; a later discovery still remains visible.
    if (!companion.exists && (await statIfPresent(targetCompanion)))
      throw new ExplorerConflictError("A companion destination appeared.");
    return moveResult(root, roots, !companion.exists && source !== destination ? targetCompanion : undefined);
  });
