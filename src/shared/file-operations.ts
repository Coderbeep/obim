import type { FileItem, WorkspaceFileVersion } from "./file-item";

export type FileOperationResult<T extends object = object> =
  ({ success: true } & T) | { success: false; error: string; errorCode?: "conflict" };

export type CreatedFileResult = FileOperationResult<{ file: FileItem }>;
export type CreatedDirectoryResult = FileOperationResult<{ directory: FileItem }>;
export interface NoteLinkUpdate {
  path: string;
  previousContent: string;
  content: string;
  version: WorkspaceFileVersion;
}
export type NoteLinkMovePaths = { beforePaths: string[]; afterPaths: string[] };
export type MovedFileResult = FileOperationResult<{ output: string }> & {
  linkUpdates?: NoteLinkUpdate[];
  linkMove?: NoteLinkMovePaths;
  updatedLinkCount?: number;
};
export type WorkspaceFileSaveResult = FileOperationResult<{ version: WorkspaceFileVersion }>;
export type WorkspaceTextFile = { content: string; version: WorkspaceFileVersion };

export type ExternalFileImportResult = {
  importedPaths: string[];
  errors: string[];
};

export type WorkspaceItemCopyResult = {
  copiedPaths: string[];
  errors: string[];
};

export type WorkspaceFileExportResult =
  { status: "exported"; path: string } | { status: "cancelled" } | { status: "error"; error: string };

export type NotePdfExportResult =
  | { status: "exported"; path: string; openToken: string }
  | { status: "cancelled" }
  | { status: "error"; error: string };
