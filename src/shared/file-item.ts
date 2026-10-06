export interface WorkspaceFileVersion {
  id?: string;
  mtimeMs: number;
  sizeBytes: number;
}

export const workspaceFileVersionsEqual = (left: WorkspaceFileVersion, right: WorkspaceFileVersion) =>
  left.id === right.id && left.mtimeMs === right.mtimeMs && left.sizeBytes === right.sizeBytes;

interface BaseFileItem {
  id: string;
  filename: string;
  relativePath: string;
  path: string;
  sizeBytes?: number;
  version?: WorkspaceFileVersion;
  children?: FileItem[];
  isOpen?: boolean;
  level?: number;
}

interface DirectoryItem extends BaseFileItem {
  isDirectory: true;
  mimeType: null;
  children?: FileItem[];
}

interface RegularFileItem extends BaseFileItem {
  isDirectory: false;
  mimeType: string;
  children?: never;
}

export type FileItem = DirectoryItem | RegularFileItem;
