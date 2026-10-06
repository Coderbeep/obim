import type { FrontmatterFieldType } from "./frontmatter-fields";
import type { FileItem } from "./file-item";
import { getFilenameNoExtFromPath, getRelativePathFromPath, isPathWithinBase } from "./pathUtils";

// ========================================
// WORKSPACE INDEX
// ========================================
export type WorkspaceIndexFile = Extract<FileItem, { isDirectory: false }>;

export const WORKSPACE_INDEX_PAGE_SIZE = 100;

export const normalizeWorkspacePropertyText = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const createBufferedWorkspaceIndexFile = (path: string, workspacePath: string): WorkspaceIndexFile => ({
  id: path,
  filename: getFilenameNoExtFromPath(path),
  relativePath: isPathWithinBase(path, workspacePath) ? getRelativePathFromPath(path, workspacePath) : path,
  path,
  isDirectory: false,
  mimeType: "text/markdown",
});

// ========================================
// FULL-TEXT SEARCH
// ========================================
export type WorkspaceTextSearchRequest = {
  query: string;
  hideCompletedTasks?: boolean;
  limit?: number;
};

export type WorkspaceTextSearchResult = {
  file: WorkspaceIndexFile;
  rank: number;
  matchedIn: "filename" | "content" | "both";
  excerpt?: string;
};

// ========================================
// FRONTMATTER
// ========================================
// Property queries
export type FrontmatterScalar =
  | { type: "null"; value: null }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string };

export type WorkspacePropertyQuery = {
  key: string;
  value?: FrontmatterScalar;
  limit?: number;
  offset?: number;
  includeInvalidTaskCandidates?: boolean;
  /** Match scalar properties rather than elements inside YAML lists. */
  scalarOnly?: boolean;
};
export type WorkspacePropertyMatch = { file: WorkspaceIndexFile; values: FrontmatterScalar[] };

// Indexed document reads
export type WorkspaceFrontmatterFieldObservation = {
  key: string;
  type: FrontmatterFieldType;
  count: number;
};
export type IndexedDocument = {
  file: WorkspaceIndexFile;
  modifiedAtMs?: number;
  source: string;
};

export type IndexedPdfReference = {
  notePath: string;
  noteRelativePath: string;
  destination: string;
  label: string;
  line: number;
};
