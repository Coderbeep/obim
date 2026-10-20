import type { FileItem } from "@shared/file-item";
import type { AttachPdfNoteRequest, MovePdfWithNotesRequest } from "@shared/explorer-pdf-notes";
import { PDF_NOTES_SUFFIX } from "@shared/explorer-pdf-notes";
import {
  basename,
  getExt,
  getPathWithoutFilename,
  getRelativePathFromPath,
  isPathWithinBase,
  joinFsPath,
  normalizeFileItemPath,
} from "@shared/pathUtils";
import { findItemNode } from "./fileTreeUtils";

export type FileMoveRoot = { source: string; destination: string; directory: boolean };
export const flattenFileTree = (items: readonly FileItem[]): FileItem[] =>
  items.flatMap((item) => [item, ...(item.isDirectory ? flattenFileTree(item.children ?? []) : [])]);

export const fileMoveRemapper = (roots: readonly FileMoveRoot[]) => {
  const sorted = [...roots].sort((a, b) => b.source.length - a.source.length);
  return (path: string) => {
    const move = sorted.find((root) => root.source === path || (root.directory && isPathWithinBase(path, root.source)));
    return move ? move.destination + path.slice(move.source.length) : path;
  };
};

const numberedDestination = (items: FileItem[], source: FileItem, directory: string, paired = false) => {
  const occupied = new Set(flattenFileTree(items).map((item) => item.path));
  const name = basename(source.path);
  const ext = source.isDirectory ? "" : getExt(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let index = 0; ; index++) {
    const candidate = joinFsPath(directory, index ? `${stem} ${index}${ext}` : name);
    if (occupied.has(candidate) && candidate !== source.path) continue;
    if (
      paired &&
      occupied.has(`${candidate}${PDF_NOTES_SUFFIX}`) &&
      `${candidate}${PDF_NOTES_SUFFIX}` !== `${source.path}${PDF_NOTES_SUFFIX}`
    )
      continue;
    return candidate;
  }
};

export const predictFileMove = (items: FileItem[], file: FileItem, directory: string): FileMoveRoot[] => [
  {
    source: file.path,
    destination: numberedDestination(items, file, directory),
    directory: file.isDirectory,
  },
];

export const predictPdfNotesMove = (
  items: FileItem[],
  request: AttachPdfNoteRequest | MovePdfWithNotesRequest,
): FileMoveRoot[] => {
  if ("notePath" in request) {
    const source = findItemNode(items, request.notePath);
    return source ? predictFileMove(items, source, `${request.pdfPath}${PDF_NOTES_SUFFIX}`) : [];
  }
  const source = findItemNode(items, request.pdfPath);
  if (!source) return [];
  const destination = request.newFilename
    ? joinFsPath(request.destinationDirectoryPath, request.newFilename)
    : numberedDestination(items, source, request.destinationDirectoryPath, true);
  const roots: FileMoveRoot[] = [{ source: source.path, destination, directory: false }];
  const companion = findItemNode(items, `${source.path}${PDF_NOTES_SUFFIX}`);
  if (companion?.isDirectory)
    roots.push({ source: companion.path, destination: `${destination}${PDF_NOTES_SUFFIX}`, directory: true });
  return roots;
};

/** Reparent real paths rather than keeping moved nodes under their old physical parent. */
export const projectFileMoves = (items: FileItem[], roots: readonly FileMoveRoot[], workspace: string): FileItem[] => {
  workspace = workspace.replace(/\\/g, "/").replace(/\/$/, "") || "/";
  const remap = fileMoveRemapper(roots);
  const nodes = new Map<string, FileItem>();
  for (const item of flattenFileTree(items)) {
    const path = remap(item.path);
    if (nodes.has(path)) throw new Error("Destination file already exists");
    const next = path === item.path ? item : normalizeFileItemPath(item, path, workspace);
    nodes.set(path, next.isDirectory ? { ...next, children: [] } : next);
  }
  const result: FileItem[] = [];
  const attach = (node: FileItem) => {
    const parent = getPathWithoutFilename(node.path);
    if (parent === workspace) {
      result.push(node);
      return;
    }
    if (!isPathWithinBase(parent, workspace)) throw new Error("Move destination is outside the workspace");
    let directory = nodes.get(parent);
    if (!directory) {
      directory = {
        id: parent,
        path: parent,
        relativePath: getRelativePathFromPath(parent, workspace),
        filename: basename(parent),
        isDirectory: true,
        mimeType: null,
        children: [],
      };
      nodes.set(parent, directory);
      attach(directory);
    }
    if (!directory.isDirectory) throw new Error("Move destination is not a folder");
    directory.children!.push(node);
  };
  for (const node of [...nodes.values()]) attach(node);
  return result;
};
