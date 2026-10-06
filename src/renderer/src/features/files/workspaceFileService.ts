import { runWorkspaceMutation, type WorkspaceTransitionLease } from "@renderer/store/workspaceTransitionStore";
import { workspaceMutationApi } from "@renderer/features/files/workspaceMutationApi";
/**
 * Renderer-side adapter for workspace filesystem operations exposed by the preload API.
 * Validates renderer inputs and normalizes IPC failures into application-facing results.
 */
import { getWorkspacePath } from "@renderer/config";
import type { WorkspaceFileVersion } from "@shared/file-item";
import type {
  CreatedDirectoryResult,
  CreatedFileResult,
  ExternalFileImportResult,
  FileOperationResult,
  MovedFileResult,
  WorkspaceFileSaveResult,
  WorkspaceItemCopyResult,
  WorkspaceTextFile,
  WorkspaceFileExportResult,
} from "@shared/file-operations";
import type { LargeTextPreview } from "@shared/large-files";
import {
  getRelativePathFromPath,
  isPathWithinBase,
  isValidFilename,
  isValidRelativePath,
  joinFsPath,
} from "@shared/pathUtils";
import { tryCatch, tryCatchSync } from "@shared/tryCatch";

const isNotesPath = (filePath: string) => isPathWithinBase(filePath, getWorkspacePath());

/**
 * Returns false both when the path is absent and when the existence check itself fails.
 */
export const doesFileExist = async (filePath: string): Promise<boolean> => {
  const result = await tryCatch<boolean>(window.api.doesFileExist(filePath));
  if (result.error) {
    console.error("Error checking file existence:", result.error);
    return false;
  }
  return result.data;
};

/** Reads a text file by path and returns its contents. */
export const readFile = async (filePath: string): Promise<FileOperationResult<{ content: string }>> => {
  const openResult = await tryCatch<string>(window.api.openFile(filePath));
  if (openResult.error) {
    return { success: false, error: String(openResult.error) };
  }
  return { success: true, content: openResult.data };
};

/** Reads a workspace file without text decoding. */
export const readBinaryFile = async (filePath: string): Promise<FileOperationResult<{ content: Uint8Array }>> => {
  const readResult = await tryCatch<Uint8Array>(window.api.readBinaryFile(filePath));
  if (readResult.error) return { success: false, error: String(readResult.error) };
  return { success: true, content: readResult.data };
};

/** Calculates the stable SHA-256 identity used by research-library source records. */
export const fingerprintWorkspaceFile = async (
  filePath: string,
): Promise<FileOperationResult<{ fingerprint: string }>> => {
  const nativeFingerprint = window.api.fingerprintWorkspaceFile;
  if (typeof nativeFingerprint === "function") {
    const result = await tryCatch<string>(nativeFingerprint(filePath));
    return result.error ? { success: false, error: String(result.error) } : { success: true, fingerprint: result.data };
  }

  // Electron's renderer can hot-reload while an older preload remains active.
  // Fall back to its existing binary bridge until the window is restarted.
  const readResult = await readBinaryFile(filePath);
  if (!readResult.success) return readResult;
  const bytes = readResult.content;
  const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await tryCatch<ArrayBuffer>(crypto.subtle.digest("SHA-256", exactBuffer));
  if (digest.error) return { success: false, error: String(digest.error) };
  const hex = [...new Uint8Array(digest.data)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return { success: true, fingerprint: `sha256:${hex}` };
};

/** Reads editor text together with the disk version required for conditional saves. */
export const readTextFile = async (filePath: string): Promise<FileOperationResult<WorkspaceTextFile>> => {
  const openResult = await tryCatch<WorkspaceTextFile>(window.api.openTextFile(filePath));
  return openResult.error ? { success: false, error: String(openResult.error) } : { success: true, ...openResult.data };
};

/** Reads the bounded, read-only preview for an oversized text file. */
export const readLargeTextPreview = async (
  filePath: string,
): Promise<FileOperationResult<{ preview: LargeTextPreview }>> => {
  const result = await tryCatch<LargeTextPreview>(window.api.readLargeTextPreview(filePath));
  if (result.error) return { success: false, error: String(result.error) };
  return { success: true, preview: result.data };
};

/** Writes text content to a file path. */
export const saveFile = async (
  filename: string,
  content: string,
  expectedVersion?: WorkspaceFileVersion,
  lease?: WorkspaceTransitionLease,
): Promise<WorkspaceFileSaveResult> => {
  if (!filename) return { success: false, error: "Missing filename" };
  if (!expectedVersion) return { success: false, error: "Missing file version" };

  const saveResult = await tryCatch<WorkspaceFileSaveResult>(
    runWorkspaceMutation(() => window.api.saveFile(filename, content, expectedVersion), lease),
  );
  if (saveResult.error) {
    return { success: false, error: String(saveResult.error) };
  }
  return saveResult.data;
};

/** Creates a markdown file and returns its filesystem metadata. */
export const createFile = async (
  directoryPath: string,
  filename: string,
  content: string = "",
): Promise<CreatedFileResult> => {
  if (!isValidFilename(filename)) return { success: false, error: "Invalid filename" };
  if (!isNotesPath(directoryPath)) return { success: false, error: "Directory is outside the notes directory" };

  const fullPath = joinFsPath(directoryPath, filename);

  const createResult = await tryCatch<CreatedFileResult>(workspaceMutationApi.createFile(fullPath, content));
  if (createResult.error) return { success: false, error: String(createResult.error) };
  return createResult.data;
};

/** Saves binary content under the notes directory. */
export const saveBinaryFile = async (relativePath: string, content: ArrayBuffer): Promise<FileOperationResult> => {
  if (!isValidRelativePath(relativePath)) return { success: false, error: "Invalid relative path" };

  const saveResult = await tryCatch<boolean>(workspaceMutationApi.saveBinaryFile(relativePath, content));
  if (saveResult.error || !saveResult.data) {
    return {
      success: false,
      error: saveResult.error ? String(saveResult.error) : `Failed to save binary file at ${relativePath}`,
    };
  }

  return { success: true };
};

/** Imports operating-system drag-and-drop files. */
export const importExternalFiles = async (
  files: readonly File[],
  destinationDirectoryPath: string,
): Promise<ExternalFileImportResult> => {
  if (files.length === 0) return { importedPaths: [], errors: ["No filesystem files were dropped."] };

  const importResult = await tryCatch<ExternalFileImportResult>(
    workspaceMutationApi.importExternalFiles(files, destinationDirectoryPath),
  );
  if (importResult.error) {
    return { importedPaths: [], errors: [String(importResult.error)] };
  }

  return {
    importedPaths: importResult.data.importedPaths,
    errors: importResult.data.errors,
  };
};

export const hasClipboardImageFiles = () => tryCatchSync(() => window.api.hasClipboardImageFiles()).data ?? false;

export const importClipboardImages = async (): Promise<{ errors: string[]; relativePaths: string[] }> => {
  const workspacePath = getWorkspacePath();
  const attachmentPath = joinFsPath(workspacePath, "attachments");
  await tryCatch(workspaceMutationApi.createDirectory(attachmentPath));

  const result = await tryCatch<ExternalFileImportResult>(workspaceMutationApi.importClipboardImages(attachmentPath));
  if (result.error) return { errors: [String(result.error)], relativePaths: [] };

  return {
    errors: result.data.errors,
    relativePaths: result.data.importedPaths.flatMap((filePath) => {
      try {
        return [getRelativePathFromPath(filePath, workspacePath)];
      } catch {
        return [];
      }
    }),
  };
};

/** Copies existing workspace items without overwriting destination entries. */
export const copyWorkspaceItems = async (
  sourcePaths: string[],
  destinationDirectoryPath: string,
  lease?: WorkspaceTransitionLease,
): Promise<WorkspaceItemCopyResult> => {
  if (sourcePaths.length === 0) return { copiedPaths: [], errors: [] };

  const copyResult = await tryCatch<WorkspaceItemCopyResult>(
    runWorkspaceMutation(() => window.api.copyWorkspaceItems(sourcePaths, destinationDirectoryPath), lease),
  );
  if (copyResult.error) {
    return { copiedPaths: [], errors: [String(copyResult.error)] };
  }

  return copyResult.data;
};

/** Renames a file or directory. */
export const renameFile = async (
  filePath: string,
  newFilename: string,
  lease?: WorkspaceTransitionLease,
): Promise<MovedFileResult> => {
  if (!isValidFilename(newFilename)) return { success: false, error: "Invalid filename" };

  const result = await tryCatch<MovedFileResult>(
    runWorkspaceMutation(() => window.api.renameFile(filePath, newFilename), lease),
  );
  return result.error ? { success: false, error: String(result.error) } : result.data;
};

/** Moves a file or directory. */
export const moveFile = async (
  sourceFilePath: string,
  targetDirectoryPath: string,
  lease?: WorkspaceTransitionLease,
): Promise<MovedFileResult> => {
  const result = await tryCatch<MovedFileResult>(
    runWorkspaceMutation(() => window.api.moveFile(sourceFilePath, targetDirectoryPath), lease),
  );
  return result.error ? { success: false, error: String(result.error) } : result.data;
};

/** Moves a file or directory to the operating system Trash. */
export const trashFile = async (filePath: string): Promise<FileOperationResult> => {
  const result = await tryCatch<FileOperationResult>(workspaceMutationApi.trashFile(filePath));
  return result.error ? { success: false, error: String(result.error) } : result.data;
};

/** Creates a directory and returns its filesystem metadata. */
export const createDirectory = async (
  parentDirectoryPath: string,
  directoryName: string,
): Promise<CreatedDirectoryResult> => {
  if (!isValidFilename(directoryName)) return { success: false, error: "Invalid filename" };
  if (!isNotesPath(parentDirectoryPath)) return { success: false, error: "Directory is outside the notes directory" };

  const fullPath = joinFsPath(parentDirectoryPath, directoryName);

  const createResult = await tryCatch<CreatedDirectoryResult>(workspaceMutationApi.createDirectory(fullPath));
  if (createResult.error) {
    return { success: false, error: String(createResult.error) };
  }
  return createResult.data;
};

/** Opens the operating system file manager with the given path selected. */
export const revealInSystemFileManager = async (filePath: string): Promise<FileOperationResult> => {
  const result = await tryCatch<FileOperationResult>(window.api.revealInSystemFileManager(filePath));
  return result.error ? { success: false, error: String(result.error) } : result.data;
};

/** Opens a file with the operating system's default application. */
export const openInDefaultApp = async (filePath: string): Promise<FileOperationResult> => {
  const result = await tryCatch<FileOperationResult>(window.api.openInDefaultApp(filePath));
  return result.error ? { success: false, error: String(result.error) } : result.data;
};

/** Saves a user-selected copy of a workspace file outside the workspace. */
export const exportWorkspaceFileCopy = async (filePath: string): Promise<WorkspaceFileExportResult> => {
  const result = await tryCatch<WorkspaceFileExportResult>(workspaceMutationApi.exportWorkspaceFileCopy(filePath));
  return result.error ? { status: "error", error: String(result.error) } : result.data;
};
