/**
 * Converts filesystem entries into renderer-facing workspace items and builds
 * the recursive file tree shown by the explorer.
 */
import crypto from "crypto";
import { lstat, open, readdir } from "fs/promises";
import path from "path";
import { lookup } from "mime-types";

import { workspaceFileVersionsEqual, type FileItem, type WorkspaceFileVersion } from "@shared/file-item";
import type { WorkspaceTextFile } from "@shared/file-operations";
import { getFilenameNoExtFromPath, getRelativePathFromPath } from "@shared/pathUtils";
import { isIgnoredWorkspaceEntry } from "@shared/workspace-entry";

type FileStat = Awaited<ReturnType<typeof lstat>>;

const makeStableFileId = (fileStat: FileStat) => {
  const { ino, dev } = fileStat;
  return typeof ino === "number" && ino > 0 && typeof dev === "number" ? `${dev}-${ino}` : undefined;
};

const makeFileId = (filePath: string, fileStat: FileStat) =>
  makeStableFileId(fileStat) ?? crypto.createHash("sha1").update(filePath).digest("hex");

export const toWorkspaceFileVersion = (fileStat: FileStat): WorkspaceFileVersion => {
  const id = makeStableFileId(fileStat);
  return {
    ...(id ? { id } : {}),
    mtimeMs: Number(fileStat.mtimeMs),
    sizeBytes: Number(fileStat.size),
  };
};

export const toRendererPath = (filePath: string) => filePath.replace(/\\/g, "/");

export const toFileItem = (filePath: string, fileStat: FileStat, workspacePath: string): FileItem => {
  const item = {
    id: makeFileId(filePath, fileStat),
    filename: getFilenameNoExtFromPath(filePath),
    relativePath: getRelativePathFromPath(filePath, workspacePath),
    path: toRendererPath(filePath),
    sizeBytes: Number(fileStat.size),
  };

  return fileStat.isDirectory()
    ? { ...item, isDirectory: true, mimeType: null, children: [] }
    : {
        ...item,
        isDirectory: false,
        mimeType: lookup(filePath) || "application/octet-stream",
        version: toWorkspaceFileVersion(fileStat),
      };
};

export const readWorkspaceTextFile = async (filePath: string): Promise<WorkspaceTextFile> => {
  const handle = await open(filePath, "r");
  try {
    const before = toWorkspaceFileVersion(await handle.stat());
    const content = await handle.readFile("utf8");
    const after = toWorkspaceFileVersion(await handle.stat());
    const current = toWorkspaceFileVersion(await lstat(filePath));
    if (!workspaceFileVersionsEqual(before, after) || !workspaceFileVersionsEqual(after, current)) {
      throw new Error("File changed while it was being opened");
    }
    return { content, version: current };
  } finally {
    await handle.close();
  }
};

/** Creates a portable content identity without loading the whole workspace file into memory. */
export const fingerprintWorkspaceFile = async (filePath: string) => {
  const handle = await open(filePath, "r");
  try {
    const before = toWorkspaceFileVersion(await handle.stat());
    const hash = crypto.createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = toWorkspaceFileVersion(await handle.stat());
    const current = toWorkspaceFileVersion(await lstat(filePath));
    if (!workspaceFileVersionsEqual(before, after) || !workspaceFileVersionsEqual(after, current)) {
      throw new Error("File changed while its fingerprint was being calculated");
    }
    return `sha256:${hash.digest("hex")}`;
  } finally {
    await handle.close();
  }
};

/** Reads one directory without exposing OS metadata, symlinks, or hidden directories to the renderer. */
export const getWorkspaceDirectoryEntries = async (
  directoryPath: string,
  workspacePath: string,
): Promise<FileItem[]> => {
  const entries = await Promise.all(
    (await readdir(directoryPath)).map(async (filename) => {
      if (isIgnoredWorkspaceEntry(filename)) return null;

      const filePath = path.join(directoryPath, filename);
      const fileStat = await lstat(filePath);
      if (fileStat.isSymbolicLink() || (fileStat.isDirectory() && filename.startsWith("."))) return null;
      return toFileItem(filePath, fileStat, workspacePath);
    }),
  );

  return entries.filter((file): file is FileItem => file !== null);
};

export const getWorkspaceFileTree = async (directoryPath: string, workspacePath: string): Promise<FileItem[]> => {
  const files = await getWorkspaceDirectoryEntries(directoryPath, workspacePath);
  await Promise.all(
    files.map(async (file) => {
      if (file.isDirectory) file.children = await getWorkspaceFileTree(file.path, workspacePath);
    }),
  );

  return files.sort(
    (left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) || left.filename.localeCompare(right.filename),
  );
};
