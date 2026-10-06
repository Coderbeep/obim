/**
 * Validates and imports external files, directories, and in-memory file data
 * into the workspace without overwriting existing entries.
 */
import { randomUUID } from "crypto";
import { cp, lstat, readdir, rm, writeFile } from "fs/promises";
import path from "path";

import { isValidFilename } from "@shared/pathUtils";
import { isIgnoredWorkspaceEntry } from "@shared/workspace-entry";

import { queueWorkspaceMutation } from "./workspace-mutations";
import { publishStagedWorkspaceItem } from "./workspace-publication";

export type ExternalFileImportResult = {
  importedPaths: string[];
  errors: string[];
};

type PathFileImportSource = {
  kind: "path";
  path: string;
};

type BufferFileImportSource = {
  kind: "buffer";
  name: string;
  content: Uint8Array;
};

export type FileImportSource = PathFileImportSource | BufferFileImportSource;

type PathImportSource = PathFileImportSource & {
  isDirectory: boolean;
};

type ImportSource = PathImportSource | BufferFileImportSource;

const isPathInside = (candidatePath: string, parentPath: string) => {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const assertImportableTree = async (sourcePath: string): Promise<PathImportSource> => {
  if (!isValidFilename(path.basename(sourcePath))) throw new Error("Filename is not portable.");
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("Symbolic links cannot be imported.");
  if (sourceStat.isFile()) return { kind: "path", path: sourcePath, isDirectory: false };
  if (!sourceStat.isDirectory()) throw new Error("Only files and directories can be imported.");

  const entries = await readdir(sourcePath, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => !isIgnoredWorkspaceEntry(entry.name))
      .map((entry) => assertImportableTree(path.join(sourcePath, entry.name))),
  );

  return { kind: "path", path: sourcePath, isDirectory: true };
};

const getImportSources = async (requestedSources: FileImportSource[]) => {
  const sources: ImportSource[] = [];
  const errors: string[] = [];
  const importableSources = requestedSources.filter((source) =>
    source.kind === "path"
      ? !isIgnoredWorkspaceEntry(path.basename(source.path))
      : !isIgnoredWorkspaceEntry(source.name),
  );
  const uniquePaths = Array.from(
    new Set(importableSources.flatMap((source) => (source.kind === "path" ? [source.path] : []))),
  ).sort((left, right) => left.length - right.length || left.localeCompare(right));

  const pathResults = await Promise.all(
    uniquePaths.map(async (sourcePath) => {
      if (!path.isAbsolute(sourcePath)) return { ok: false as const, error: "Import source path must be absolute." };
      try {
        return { ok: true as const, source: await assertImportableTree(path.resolve(sourcePath)) };
      } catch (error) {
        const sourceName = path.basename(sourcePath) || sourcePath;
        return {
          ok: false as const,
          error: `${sourceName}: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }),
  );

  for (const result of pathResults) {
    if (!result.ok) {
      errors.push(result.error);
    } else if (
      !sources.some(
        (parent) => parent.kind === "path" && parent.isDirectory && isPathInside(result.source.path, parent.path),
      )
    ) {
      sources.push(result.source);
    }
  }

  for (const source of importableSources) {
    if (source.kind !== "buffer") continue;
    if (!isValidFilename(source.name)) {
      errors.push(`${source.name || "Clipboard file"}: Filename is not portable.`);
      continue;
    }
    sources.push(source);
  }

  return { sources, errors };
};

/**
 * Imports path-based or buffered files into a directory without overwriting existing entries.
 * Each item is fully staged before reserving an exclusive destination. Directory
 * publication can briefly expose children as they are linked into the new folder.
 */
export const importExternalFiles = async (
  requestedSources: FileImportSource[],
  destinationDirectoryPath: string,
): Promise<ExternalFileImportResult> =>
  queueWorkspaceMutation(async () => {
    const importedPaths: string[] = [];
    const errors: string[] = [];
    const destinationPath = path.resolve(destinationDirectoryPath);

    let sources: ImportSource[];
    try {
      const destinationStat = await lstat(destinationPath);
      if (!destinationStat.isDirectory()) throw new Error("Import destination is not a directory.");
      const sourceResult = await getImportSources(requestedSources);
      sources = sourceResult.sources;
      errors.push(...sourceResult.errors);
    } catch (error) {
      return { importedPaths, errors: [error instanceof Error ? error.message : String(error)] };
    }

    for (const source of sources) {
      const sourceName = source.kind === "path" ? path.basename(source.path) : source.name;
      if (source.kind === "path" && source.isDirectory && isPathInside(destinationPath, source.path)) {
        errors.push(`${sourceName}: a folder cannot be imported into itself.`);
        continue;
      }

      const stagingPath = path.join(destinationPath, `.obim-import-${randomUUID()}`);

      try {
        if (source.kind === "path") {
          await cp(source.path, stagingPath, {
            recursive: source.isDirectory,
            force: false,
            errorOnExist: true,
            filter: (sourcePath) => !isIgnoredWorkspaceEntry(path.basename(sourcePath)),
          });
        } else {
          await writeFile(stagingPath, source.content, { flag: "wx" });
        }
        const finalPath = await publishStagedWorkspaceItem(stagingPath, path.join(destinationPath, sourceName));
        importedPaths.push(finalPath);
      } catch (error) {
        errors.push(`${sourceName}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await rm(stagingPath, { force: true, recursive: true }).catch(() => undefined);
      }
    }

    return { importedPaths, errors };
  });
