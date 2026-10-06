import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
import type { FileItem } from "@shared/file-item";

export const BOOKMARKS_RELATIVE_PATH = ".obim/bookmarks.json";

interface BookmarkFile {
  items: { type: "file"; path: string }[];
}

const parseBookmarkPaths = (source: string): string[] => {
  try {
    const parsed = JSON.parse(source) as Partial<BookmarkFile>;
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items.flatMap((item) => (item?.type === "file" && typeof item.path === "string" ? [item.path] : []));
  } catch {
    return [];
  }
};

const workspaceFiles = (items: readonly FileItem[]): FileItem[] =>
  items.flatMap((item) => (item.isDirectory ? workspaceFiles(item.children ?? []) : [item]));

/** Loads workspace-relative bookmarks and resolves them against the current file tree. */
export const loadBookmarks = async (items: readonly FileItem[]): Promise<FileItem[]> => {
  if (!(await window.api.doesFileExist(BOOKMARKS_RELATIVE_PATH))) return [];

  const filesByPath = new Map(workspaceFiles(items).map((file) => [file.relativePath, file]));
  const paths = parseBookmarkPaths(await window.api.openFile(BOOKMARKS_RELATIVE_PATH));
  return [...new Set(paths)].flatMap((path) => filesByPath.get(path) ?? []);
};

/** Writes file bookmarks as workspace-relative paths inside `.obim/bookmarks.json`. */
export const saveBookmarks = async (bookmarks: readonly FileItem[]): Promise<void> => {
  const paths = [...new Set(bookmarks.map(({ relativePath }) => relativePath))];
  const content = JSON.stringify(
    { items: paths.map((path) => ({ type: "file" as const, path })) } satisfies BookmarkFile,
    null,
    2,
  );

  if (!(await workspaceMutationApi.upsertFile(BOOKMARKS_RELATIVE_PATH, `${content}\n`))) {
    throw new Error(`Could not write ${BOOKMARKS_RELATIVE_PATH}`);
  }
};
