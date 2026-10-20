import type {
  FileTreeDropTarget,
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeRenameEvent,
} from "@pierre/trees";

import type { FileItem } from "@shared/file-item";
import { getPdfNotesGroups, PDF_NOTES_SUFFIX } from "@shared/explorer-pdf-notes";
import { isMarkdownFile, isPdfFile } from "@shared/mime-types";
import { basename, getExt, getPathWithoutFilename, stripLastExt } from "@shared/pathUtils";

export type TreeLookup = {
  byAbsolutePath: Map<string, string>;
  byTreePath: Map<string, FileItem>;
  directoryTreePaths: string[];
  paths: readonly string[];
  pdfGroups?: ReadonlyMap<string, { pdf: FileItem; directory: FileItem }>;
};

export type FileTreeDropDestination = {
  absolutePath: string;
  directory: FileItem | null;
  treePath: string;
};

export type FileTreeMoveIntent = FileTreeDropDestination & {
  sourceItems: FileItem[];
  sourceTreePaths: string[];
};

export const getPdfAttachmentTarget = (treePath: string | null, lookup: TreeLookup): FileItem | null => {
  const file = treePath ? lookup.byTreePath.get(treePath) : null;
  return file && !file.isDirectory && isPdfFile(file.mimeType, file.path) ? file : null;
};

/** A PDF row accepts notes explicitly; invalid attachments must never fall back to its parent. */
export const getPdfNoteDropItems = (draggedPaths: readonly string[], pdf: FileItem, lookup: TreeLookup) => {
  const items = normalizeDraggedTreePaths(draggedPaths).map((key) => lookup.byTreePath.get(key));
  if (!items.length || items.some((file) => !file || file.isDirectory || !isMarkdownFile(file.mimeType, file.path)))
    return [];
  return (items as FileItem[]).filter((file) => getPathWithoutFilename(file.path) !== `${pdf.path}${PDF_NOTES_SUFFIX}`);
};

export const EMPTY_LOOKUP: TreeLookup = {
  byAbsolutePath: new Map(),
  byTreePath: new Map(),
  directoryTreePaths: [],
  paths: [],
};

export const normalizeTreePath = (path: string) => path.replace(/\\/g, "/").replace(/^\/+/, "");
export const toDirectoryTreePath = (path: string) => {
  const normalized = normalizeTreePath(path).replace(/\/+$/, "");
  return normalized ? `${normalized}/` : "";
};

export const toTreePath = (file: FileItem) => {
  const normalized = normalizeTreePath(file.relativePath);
  return file.isDirectory ? toDirectoryTreePath(normalized) : normalized;
};

export const toRelativeDirectoryPath = (treePath: string) => normalizeTreePath(treePath).replace(/\/+$/, "");

export const getDirectoryTreePathChain = (treePath: string) => {
  const parts = toRelativeDirectoryPath(treePath).split("/").filter(Boolean);
  return parts.map((_, index) => `${parts.slice(0, index + 1).join("/")}/`);
};

export const sameStringArray = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);

export const sameStringSet = (left: Set<string>, right: Set<string>) => {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
};

export const getParentTreePath = (path: string) => {
  const normalized = path.replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? `${normalized.slice(0, slashIndex)}/` : "";
};

export const normalizeDraggedTreePaths = (paths: readonly string[]) => {
  const uniquePaths = Array.from(new Set(paths));
  const keptPaths = new Set<string>();

  [...uniquePaths]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .forEach((path) => {
      const normalizedPath = path.replace(/\/+$/, "");
      let slashIndex = normalizedPath.indexOf("/");
      let hasSelectedAncestor = false;

      while (slashIndex >= 0) {
        if (keptPaths.has(`${normalizedPath.slice(0, slashIndex)}/`)) {
          hasSelectedAncestor = true;
          break;
        }
        slashIndex = normalizedPath.indexOf("/", slashIndex + 1);
      }

      if (!hasSelectedAncestor) keptPaths.add(path);
    });

  return uniquePaths.filter((path) => keptPaths.has(path));
};

export const getMovableTreePaths = (draggedPaths: readonly string[], targetTreePath: string, lookup: TreeLookup) =>
  normalizeDraggedTreePaths(draggedPaths).filter((treePath) => {
    const sourceItem = lookup.byTreePath.get(treePath);
    if (!sourceItem || treePath === targetTreePath) return false;
    if ((sourceItem.isDirectory || lookup.pdfGroups?.has(treePath)) && targetTreePath.startsWith(treePath))
      return false;
    return getParentTreePath(treePath) !== targetTreePath;
  });

export const getTreeDropDestination = (
  target: Pick<FileTreeDropTarget, "directoryPath" | "kind">,
  lookup: TreeLookup,
  rootDirectoryPath: string,
): FileTreeDropDestination | null => {
  const treePath = target.kind === "root" ? "" : target.directoryPath;
  if (treePath === null) return null;
  if (!treePath) return { absolutePath: rootDirectoryPath, directory: null, treePath: "" };

  const directory = lookup.pdfGroups?.get(treePath)?.directory ?? lookup.byTreePath.get(treePath);
  return directory?.isDirectory ? { absolutePath: directory.path, directory, treePath } : null;
};

export const getTreeDropTargetFromHoveredPath = (
  hoveredTreePath: string | null,
  lookup: TreeLookup,
): Pick<FileTreeDropTarget, "directoryPath" | "kind"> => {
  if (!hoveredTreePath) return { directoryPath: null, kind: "root" };

  const hoveredItem = lookup.byTreePath.get(hoveredTreePath);
  const directoryPath =
    hoveredItem?.isDirectory || lookup.pdfGroups?.has(hoveredTreePath)
      ? hoveredTreePath
      : getParentTreePath(hoveredTreePath);
  return directoryPath ? { directoryPath, kind: "directory" } : { directoryPath: null, kind: "root" };
};

export const getFileTreeMoveIntent = (
  draggedPaths: readonly string[],
  target: Pick<FileTreeDropTarget, "directoryPath" | "kind"> & Partial<Pick<FileTreeDropTarget, "hoveredPath">>,
  lookup: TreeLookup,
  rootDirectoryPath: string,
): FileTreeMoveIntent | null => {
  if (getPdfAttachmentTarget(target.hoveredPath ?? null, lookup)) return null;
  const destination = getTreeDropDestination(target, lookup, rootDirectoryPath);
  if (!destination) return null;

  const sourceTreePaths = getMovableTreePaths(draggedPaths, destination.treePath, lookup);
  const sourceItems = sourceTreePaths
    .map((treePath) => lookup.byTreePath.get(treePath))
    .filter((item): item is FileItem => Boolean(item));
  if (sourceItems.length === 0) return null;

  return { ...destination, sourceItems, sourceTreePaths };
};

export const isTreeDirectoryHandle = (item: FileTreeItemHandle | null): item is FileTreeDirectoryHandle =>
  Boolean(item && item.isDirectory());

export const buildTreeLookup = (items: FileItem[]): TreeLookup => {
  const files: FileItem[] = [];

  const visit = (file: FileItem) => {
    files.push(file);
    if (file.isDirectory) file.children?.forEach(visit);
  };

  items.forEach(visit);

  const paths: string[] = [];
  const directoryTreePaths: string[] = [];
  const byTreePath = new Map<string, FileItem>();
  const byAbsolutePath = new Map<string, string>();
  const seenTreePaths = new Set<string>();

  files.forEach((file) => {
    const treePath = toTreePath(file);
    if (!treePath || seenTreePaths.has(treePath)) return;
    seenTreePaths.add(treePath);

    paths.push(treePath);
    byTreePath.set(treePath, file);
    byAbsolutePath.set(file.path, treePath);
    if (file.isDirectory) directoryTreePaths.push(treePath);
  });

  return { byAbsolutePath, byTreePath, directoryTreePaths, paths };
};

/** Replace only companion wrapper rows; all descendant paths remain real filesystem paths. */
export const buildExplorerTreeLookup = (items: FileItem[]): TreeLookup => {
  const lookup = buildTreeLookup(items);
  const pdfGroups = new Map<string, { pdf: FileItem; directory: FileItem }>();
  const hiddenPdfPaths = new Set<string>();
  const hiddenEmptyDirectories = new Set<string>();
  const directoriesWithChildren = new Set(lookup.paths.map(getParentTreePath));
  for (const group of getPdfNotesGroups(items)) {
    const pdfKey = lookup.byAbsolutePath.get(group.pdfPath);
    const directoryKey = lookup.byAbsolutePath.get(group.notesDirectoryPath);
    const pdf = pdfKey ? lookup.byTreePath.get(pdfKey) : undefined;
    const directory = directoryKey ? lookup.byTreePath.get(directoryKey) : undefined;
    if (!pdfKey || !directoryKey || !pdf || !directory?.isDirectory) continue;
    if (!directoriesWithChildren.has(directoryKey)) {
      hiddenEmptyDirectories.add(directoryKey);
      lookup.byTreePath.delete(directoryKey);
      lookup.byAbsolutePath.delete(directory.path);
      continue;
    }
    hiddenPdfPaths.add(pdfKey);
    lookup.byTreePath.delete(pdfKey);
    lookup.byTreePath.set(directoryKey, pdf);
    lookup.byAbsolutePath.set(pdf.path, directoryKey);
    pdfGroups.set(directoryKey, { pdf, directory });
  }
  return {
    ...lookup,
    paths: lookup.paths.filter((key) => !hiddenPdfPaths.has(key) && !hiddenEmptyDirectories.has(key)),
    directoryTreePaths: lookup.directoryTreePaths.filter((key) => !hiddenEmptyDirectories.has(key)),
    pdfGroups,
  };
};

export const getExplorerRowName = (file: FileItem, treePath: string, lookup: TreeLookup) =>
  lookup.pdfGroups?.has(treePath) ? basename(file.path) : getMarkdownExplorerName(file);

export const getTreePathName = (path: string) => basename(path.replace(/\/+$/, ""));

export const getUniqueTreeMovePath = (
  sourceTreePath: string,
  destinationTreePath: string,
  occupiedPaths: Set<string>,
) => {
  const isDirectory = sourceTreePath.endsWith("/");
  const sourceName = getTreePathName(sourceTreePath);
  const extension = sourceName.lastIndexOf(".") > 0 ? getExt(sourceName) : "";
  const baseName = extension ? sourceName.slice(0, -extension.length) : sourceName;

  for (let index = 0; ; index += 1) {
    const name = index === 0 ? sourceName : `${baseName} ${index}${extension}`;
    const candidate = `${destinationTreePath}${name}${isDirectory ? "/" : ""}`;
    if (!occupiedPaths.has(candidate)) return candidate;
  }
};

export const getMarkdownExplorerName = (file: FileItem) =>
  !file.isDirectory && isMarkdownFile(file.mimeType, file.path) ? stripLastExt(basename(file.path)) : null;

export const getRenamingItemTreePath = (item: { isFolder: boolean; path: string }) =>
  item.isFolder ? toDirectoryTreePath(item.path) : normalizeTreePath(item.path);

export const getRenameEventSourceTreePath = (event: Pick<FileTreeRenameEvent, "isFolder" | "sourcePath">) =>
  getRenamingItemTreePath({ isFolder: event.isFolder, path: event.sourcePath });

export const getRenameEventDestinationName = (event: Pick<FileTreeRenameEvent, "destinationPath">) =>
  getTreePathName(event.destinationPath);
