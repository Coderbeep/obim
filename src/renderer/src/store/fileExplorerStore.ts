import { FileItem } from "@shared/file-item";
import {
  MAX_WORKSPACE_SESSION_RECENT_FILES,
  type WorkspaceSessionExplorerSectionSizes,
  type WorkspaceSessionExplorerSections,
} from "@shared/workspace-session";
import { atom } from "jotai";

export const fileTreeAtom = atom<FileItem[]>([]);
/** Last successful open time by absolute workspace-file path. */
export const fileAccessesAtom = atom<Record<string, number>>({});
export const explorerSectionsAtom = atom<WorkspaceSessionExplorerSections>({
  bookmarks: true,
  files: true,
  recent: false,
});
export const DEFAULT_EXPLORER_SECTION_SIZES: WorkspaceSessionExplorerSectionSizes = {
  bookmarks: 1,
  files: 2,
  recent: 1,
};
export const explorerSectionSizesAtom = atom<WorkspaceSessionExplorerSectionSizes>(DEFAULT_EXPLORER_SECTION_SIZES);
export const fileTreeLoadStateAtom = atom<"idle" | "loading" | "ready" | "error">("idle");

const flattenWorkspaceFiles = (items: readonly FileItem[]): FileItem[] =>
  items.flatMap((item) => (item.isDirectory ? flattenWorkspaceFiles(item.children ?? []) : [item]));

export const workspaceFilesAtom = atom((get) => flattenWorkspaceFiles(get(fileTreeAtom)));

export const expandedDirectoriesAtom = atom<Set<string>>(new Set<string>());
export const explorerSelectionPathsAtom = atom<string[]>([]);
export const recentFilesAtom = atom<FileItem[]>([]);

export const copiedWorkspaceFilePathsAtom = atom<string[] | null>(null);

export const addRecentFile = (
  files: FileItem[],
  file: FileItem,
  limit = MAX_WORKSPACE_SESSION_RECENT_FILES,
): FileItem[] => {
  const updatedFiles = [file, ...files.filter((recentFile) => recentFile.path !== file.path)];
  return updatedFiles.slice(0, limit);
};

/** Increments for every requested file-tree refresh; revisions cannot cancel in a React batch. */
export const reloadRevisionAtom = atom(0);

export type FileExplorerRevealRequest = {
  relativePath: string;
};

export const fileExplorerRevealRequestAtom = atom<FileExplorerRevealRequest | null>(null);

export type RenameTarget = "explorer" | "file-header" | "note-header";

export type RenamingRequest = {
  filePath: string;
  target: RenameTarget;
};

export const renamingRequestAtom = atom<RenamingRequest | null>(null);
