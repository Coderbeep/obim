import { isEditableFile } from "./mime-types";
import type { FileItem } from "./file-item";

// Changing this threshold requires a workspace-index rebuild.
export const MAX_FULL_TEXT_EDITOR_BYTES = 10 * 1024 * 1024;
export const LARGE_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

export type LargeTextPreview = {
  content: string;
  previewBytes: number;
  sizeBytes: number;
  truncated: boolean;
};

export const isLargeTextFile = (file: FileItem) =>
  !file.isDirectory &&
  typeof file.sizeBytes === "number" &&
  file.sizeBytes > MAX_FULL_TEXT_EDITOR_BYTES &&
  isEditableFile(file.mimeType, file.path);
