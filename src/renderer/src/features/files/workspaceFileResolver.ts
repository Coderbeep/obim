import { findItemNode } from "./fileTreeUtils";
import {
  createFileHistoryWorkspaceItem,
  createFileWorkspaceItem,
  createGitConflictWorkspaceItem,
  getFileHistoryWorkspacePathFromKey,
  getWorkspaceFilePathFromKey,
  getGitConflictWorkspacePathFromKey,
  restoreStaticWorkspaceItem,
  type WorkspaceItem,
} from "@shared/workspace";
import type { FileItem } from "@shared/file-item";
import { isMarkdownFile, isSupportedImagePath } from "@shared/mime-types";
import {
  basename,
  getPathWithoutFilename,
  getRelativePathFromPath,
  isAbsoluteFsPath,
  stripLastExt,
} from "@shared/pathUtils";

export const resolveWorkspaceItemFromState = (
  resourceKey: string,
  openItemsByKey: Readonly<Record<string, WorkspaceItem>>,
  fileTree: FileItem[] = [],
  workspacePath = "",
): WorkspaceItem | null => {
  const existing = openItemsByKey[resourceKey];
  if (existing) return existing;

  const path = getWorkspaceFilePathFromKey(resourceKey);
  if (path) {
    const file = findItemNode(fileTree, path);
    if (file && !file.isDirectory) return createFileWorkspaceItem(file);
  }

  const historyPath = getFileHistoryWorkspacePathFromKey(resourceKey);
  if (historyPath) {
    const file = findItemNode(fileTree, historyPath);
    if (file && !file.isDirectory) return createFileHistoryWorkspaceItem(file);
  }

  const conflictPath = getGitConflictWorkspacePathFromKey(resourceKey);
  if (conflictPath && workspacePath) {
    try {
      return createGitConflictWorkspaceItem(conflictPath, getRelativePathFromPath(conflictPath, workspacePath));
    } catch {
      return null;
    }
  }

  return restoreStaticWorkspaceItem(resourceKey);
};

const normalizeRelativeLinkPath = (path: string) => {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
};

const flattenFileTree = (fileTree: FileItem[]) => {
  const allItems: FileItem[] = [];
  const pending = [...fileTree];
  while (pending.length > 0) {
    const item = pending.pop()!;
    allItems.push(item);
    if (item.children) pending.push(...item.children);
  }
  return allItems;
};

const normalizeContainedRelativePath = (path: string) => {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
};

const literalThenDecoded = (value: string) => {
  const values = [value];
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) values.push(decoded);
  } catch {
    /* A literal percent sign is a valid filename character. */
  }
  return values;
};

/** Resolves an Obsidian-style image target using note, root, then basename semantics. */
export const resolveWikiImageWorkspaceFile = (
  target: string,
  fileTree: FileItem[],
  sourceFilePath?: string,
): Extract<FileItem, { isDirectory: false }> | null => {
  const allItems = flattenFileTree(fileTree);
  const allFiles = allItems.filter(
    (item): item is Extract<FileItem, { isDirectory: false }> => !item.isDirectory && isSupportedImagePath(item.path),
  );
  const source = sourceFilePath ? allItems.find((item) => !item.isDirectory && item.path === sourceFilePath) : null;
  const sourceDirectory = source ? getPathWithoutFilename(source.relativePath) : "";
  const normalizedTarget = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");

  for (const value of literalThenDecoded(normalizedTarget)) {
    const rootCandidate = normalizeContainedRelativePath(value);
    const noteCandidate = source ? normalizeContainedRelativePath(`${sourceDirectory}/${value}`) : null;
    const orderedCandidates = value.includes("/") ? [rootCandidate, noteCandidate] : [noteCandidate, rootCandidate];

    for (const candidate of orderedCandidates) {
      if (!candidate) continue;
      const match = allFiles.find((file) => file.relativePath === candidate);
      if (match) return match;
    }

    if (value.includes("/")) continue;
    const lowerBasename = basename(value).toLowerCase();
    const matches = allFiles
      .filter((file) => basename(file.relativePath).toLowerCase() === lowerBasename)
      .sort((left, right) => {
        const depth = left.relativePath.split("/").length - right.relativePath.split("/").length;
        if (depth) return depth;
        return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
      });
    if (matches[0]) return matches[0];
  }

  return null;
};

/** Resolves a Writer-style wiki note target to a concrete workspace path while preserving its heading fragment. */
export const resolveWikiNoteWorkspacePath = (target: string, fileTree: FileItem[]): string | null => {
  const normalizedTarget = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const hash = normalizedTarget.indexOf("#");
  const rawPath = hash === -1 ? normalizedTarget : normalizedTarget.slice(0, hash);
  const fragment = hash === -1 ? "" : normalizedTarget.slice(hash);
  if (!rawPath) return fragment || null;

  const markdownFiles = flattenFileTree(fileTree).filter(
    (item): item is Extract<FileItem, { isDirectory: false }> =>
      !item.isDirectory && isMarkdownFile(item.mimeType, item.path),
  );

  for (const value of literalThenDecoded(rawPath)) {
    const withoutExtension = value.replace(/\.(?:md|markdown)$/i, "");
    if (withoutExtension.includes("/")) {
      const base = normalizeContainedRelativePath(withoutExtension);
      if (!base) continue;
      const match = markdownFiles.find(
        (file) => file.relativePath === `${base}.md` || file.relativePath === `${base}.markdown`,
      );
      if (match) return `${match.relativePath}${fragment}`;
      continue;
    }

    const lowerStem = withoutExtension.toLowerCase();
    const matches = markdownFiles.filter(
      (file) => stripLastExt(basename(file.relativePath)).toLowerCase() === lowerStem,
    );
    if (matches.length === 1) return `${matches[0].relativePath}${fragment}`;
    if (matches.length > 1) return null;
  }

  return null;
};

/** Produces Writer's shortest stable wiki target for a selected Markdown file. */
export const canonicalWikiNoteTarget = (target: string, fileTree: FileItem[]): string => {
  const normalizedTarget = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const hash = normalizedTarget.indexOf("#");
  const rawPath = hash === -1 ? normalizedTarget : normalizedTarget.slice(0, hash);
  const fragment = hash === -1 ? "" : normalizedTarget.slice(hash);
  if (!rawPath) return fragment;

  const markdownFiles = flattenFileTree(fileTree).filter(
    (item): item is Extract<FileItem, { isDirectory: false }> =>
      !item.isDirectory && isMarkdownFile(item.mimeType, item.path),
  );
  const selected = literalThenDecoded(rawPath)
    .map((value) => normalizeContainedRelativePath(value))
    .filter((value): value is string => value !== null)
    .map((value) => markdownFiles.find((file) => file.relativePath === value))
    .find((file) => file !== undefined);
  if (!selected) return `${rawPath.replace(/\.(?:md|markdown)$/i, "")}${fragment}`;

  const stem = stripLastExt(basename(selected.relativePath));
  const stemMatches = markdownFiles.filter(
    (file) => stripLastExt(basename(file.relativePath)).toLowerCase() === stem.toLowerCase(),
  );
  const stablePath = stemMatches.length === 1 ? stem : selected.relativePath.replace(/\.(?:md|markdown)$/i, "");
  return `${stablePath}${fragment}`;
};

export const resolveLinkedWorkspaceItem = (
  path: string,
  fileTree: FileItem[],
  sourceFilePath?: string,
  allowFragment = true,
) => {
  const allItems = flattenFileTree(fileTree);
  const source = sourceFilePath ? allItems.find((item) => !item.isDirectory && item.path === sourceFilePath) : null;
  // Match literal filenames first; retain support for previously encoded links.
  const paths = [path];
  if (allowFragment && path.includes("#")) paths.push(path.slice(0, path.indexOf("#")));
  for (const candidate of paths) {
    const decoded = [candidate];
    try {
      const value = decodeURIComponent(candidate);
      if (value !== candidate) {
        // Rooted Markdown destinations are URI paths. Preserve literal absolute
        // filesystem links, but decode generated workspace-root links first.
        if (candidate.startsWith("/") && !allItems.some((item) => !item.isDirectory && item.path === candidate))
          decoded.unshift(value);
        else decoded.push(value);
      }
    } catch {
      /* Legacy literal percent signs. */
    }
    for (const value of decoded) {
      const candidates = new Set([value, normalizeRelativeLinkPath(value)]);
      if (source && !isAbsoluteFsPath(value))
        candidates.add(normalizeRelativeLinkPath(`${getPathWithoutFilename(source.relativePath)}/${value}`));
      const file = allItems.find(
        (item) => !item.isDirectory && (candidates.has(item.path) || candidates.has(item.relativePath)),
      );
      if (file) return createFileWorkspaceItem(file);
    }
  }
  return null;
};
