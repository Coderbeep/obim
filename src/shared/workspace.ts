import type { FileItem } from "./file-item";
import { getRelativePathFromPath, normalizeFileItemPath } from "./pathUtils";

// ========================================
// WORKSPACE ITEM KEYS
// ========================================
export const WORKSPACE_ITEM_KINDS = {
  file: "file",
  fileHistory: "file-history",
  gitConflict: "git-conflict",
  taskboard: "taskboard",
} as const;

export type WorkspaceItemKind = (typeof WORKSPACE_ITEM_KINDS)[keyof typeof WORKSPACE_ITEM_KINDS];

export interface WorkspaceItemKeyParts {
  kind: WorkspaceItemKind | string;
  id: string;
}

const TASK_BOARD_RESOURCE_ID = "taskboard";

export const createWorkspaceItemKey = ({ kind, id }: WorkspaceItemKeyParts) => `${kind}:${encodeURIComponent(id)}`;

export const parseWorkspaceItemKey = (workspaceItemKey: string): WorkspaceItemKeyParts | null => {
  const separatorIndex = workspaceItemKey.indexOf(":");
  if (separatorIndex <= 0) return null;

  try {
    return {
      kind: workspaceItemKey.slice(0, separatorIndex),
      id: decodeURIComponent(workspaceItemKey.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
};

export const createFileWorkspaceItemKey = (path: string) =>
  createWorkspaceItemKey({
    kind: WORKSPACE_ITEM_KINDS.file,
    id: path,
  });

export const createFileHistoryWorkspaceItemKey = (path: string) =>
  createWorkspaceItemKey({
    kind: WORKSPACE_ITEM_KINDS.fileHistory,
    id: path,
  });

export const createGitConflictWorkspaceItemKey = (path: string) =>
  createWorkspaceItemKey({
    kind: WORKSPACE_ITEM_KINDS.gitConflict,
    id: path,
  });

export const getWorkspaceFilePathFromKey = (workspaceItemKey: string) => {
  const parsed = parseWorkspaceItemKey(workspaceItemKey);
  return parsed?.kind === WORKSPACE_ITEM_KINDS.file ? parsed.id : null;
};

export const getFileHistoryWorkspacePathFromKey = (workspaceItemKey: string) => {
  const parsed = parseWorkspaceItemKey(workspaceItemKey);
  return parsed?.kind === WORKSPACE_ITEM_KINDS.fileHistory ? parsed.id : null;
};

export const getGitConflictWorkspacePathFromKey = (workspaceItemKey: string) => {
  const parsed = parseWorkspaceItemKey(workspaceItemKey);
  return parsed?.kind === WORKSPACE_ITEM_KINDS.gitConflict ? parsed.id : null;
};

/** Returns the backing file path for file, history, and conflict resources. */
export const getWorkspaceReferenceFilePathFromKey = (workspaceItemKey: string) =>
  getWorkspaceFilePathFromKey(workspaceItemKey) ??
  getFileHistoryWorkspacePathFromKey(workspaceItemKey) ??
  getGitConflictWorkspacePathFromKey(workspaceItemKey);

export const remapFileWorkspaceItemKey = (workspaceItemKey: string, remapPath: (path: string) => string) => {
  const filePath = getWorkspaceFilePathFromKey(workspaceItemKey);
  if (filePath) return createFileWorkspaceItemKey(remapPath(filePath));
  const historyPath = getFileHistoryWorkspacePathFromKey(workspaceItemKey);
  if (historyPath) return createFileHistoryWorkspaceItemKey(remapPath(historyPath));
  const conflictPath = getGitConflictWorkspacePathFromKey(workspaceItemKey);
  if (conflictPath) return createGitConflictWorkspaceItemKey(remapPath(conflictPath));
  return workspaceItemKey;
};

export const createWorkspaceItemKeyRemapper = (remapPath: (path: string) => string) => (workspaceItemKey: string) =>
  remapFileWorkspaceItemKey(workspaceItemKey, remapPath);

// ========================================
// RESOLVED WORKSPACE ITEMS
// ========================================
export interface BaseWorkspaceItem {
  key: string;
  kind: string;
}

export interface FileWorkspaceItem extends BaseWorkspaceItem {
  kind: typeof WORKSPACE_ITEM_KINDS.file;
  file: FileItem;
}

export interface FileHistoryWorkspaceItem extends BaseWorkspaceItem {
  kind: typeof WORKSPACE_ITEM_KINDS.fileHistory;
  file: FileItem;
}

export interface GitConflictWorkspaceItem extends BaseWorkspaceItem {
  kind: typeof WORKSPACE_ITEM_KINDS.gitConflict;
  path: string;
  relativePath: string;
}

export interface TaskBoardWorkspaceItem extends BaseWorkspaceItem {
  kind: typeof WORKSPACE_ITEM_KINDS.taskboard;
  title: string;
}

export type WorkspaceItem =
  | FileWorkspaceItem
  | FileHistoryWorkspaceItem
  | GitConflictWorkspaceItem
  | TaskBoardWorkspaceItem;

export const createFileWorkspaceItem = (file: FileItem): FileWorkspaceItem => ({
  key: createFileWorkspaceItemKey(file.path),
  kind: WORKSPACE_ITEM_KINDS.file,
  file,
});

export const createFileHistoryWorkspaceItem = (file: FileItem): FileHistoryWorkspaceItem => ({
  key: createFileHistoryWorkspaceItemKey(file.path),
  kind: WORKSPACE_ITEM_KINDS.fileHistory,
  file,
});

export const createGitConflictWorkspaceItem = (path: string, relativePath: string): GitConflictWorkspaceItem => ({
  key: createGitConflictWorkspaceItemKey(path),
  kind: WORKSPACE_ITEM_KINDS.gitConflict,
  path,
  relativePath,
});

export const createTaskBoardWorkspaceItem = (): TaskBoardWorkspaceItem => ({
  key: createWorkspaceItemKey({ kind: WORKSPACE_ITEM_KINDS.taskboard, id: TASK_BOARD_RESOURCE_ID }),
  kind: WORKSPACE_ITEM_KINDS.taskboard,
  title: "Task Board",
});

export const isFileWorkspaceItem = (item?: WorkspaceItem | null): item is FileWorkspaceItem =>
  item?.kind === WORKSPACE_ITEM_KINDS.file;

export const isFileHistoryWorkspaceItem = (item?: WorkspaceItem | null): item is FileHistoryWorkspaceItem =>
  item?.kind === WORKSPACE_ITEM_KINDS.fileHistory;

export const isGitConflictWorkspaceItem = (item?: WorkspaceItem | null): item is GitConflictWorkspaceItem =>
  item?.kind === WORKSPACE_ITEM_KINDS.gitConflict;

export const isTaskBoardWorkspaceItem = (item?: WorkspaceItem | null): item is TaskBoardWorkspaceItem =>
  item?.kind === WORKSPACE_ITEM_KINDS.taskboard;

export const getWorkspaceFilePath = (item?: WorkspaceItem | null) => (isFileWorkspaceItem(item) ? item.file.path : "");

export const restoreStaticWorkspaceItem = (workspaceItemKey: string): WorkspaceItem | null => {
  const parsed = parseWorkspaceItemKey(workspaceItemKey);
  if (parsed?.kind === WORKSPACE_ITEM_KINDS.taskboard) return createTaskBoardWorkspaceItem();
  return null;
};

export const resolveStoredWorkspaceItem = (
  workspaceItemKey: string,
  openItemsByKey: Readonly<Record<string, WorkspaceItem>>,
) => openItemsByKey[workspaceItemKey] ?? restoreStaticWorkspaceItem(workspaceItemKey);

export const remapWorkspaceItems = (
  itemsByKey: Readonly<Record<string, WorkspaceItem>>,
  remapPath: (path: string) => string,
  notesDirectoryPath: string,
) =>
  Object.fromEntries(
    Object.values(itemsByKey).map((item) => {
      if (isGitConflictWorkspaceItem(item)) {
        const path = remapPath(item.path);
        const relativePath = getRelativePathFromPath(path, notesDirectoryPath);
        const next = createGitConflictWorkspaceItem(path, relativePath);
        return [next.key, next];
      }
      if (!isFileWorkspaceItem(item) && !isFileHistoryWorkspaceItem(item)) return [item.key, item];
      const path = remapPath(item.file.path);
      const file = path === item.file.path ? item.file : normalizeFileItemPath(item.file, path, notesDirectoryPath);
      const next = isFileHistoryWorkspaceItem(item)
        ? createFileHistoryWorkspaceItem(file)
        : createFileWorkspaceItem(file);
      return [next.key, next];
    }),
  );
