import type { FileItem } from "./file-item";
import type { NoteLinkMovePaths, NoteLinkUpdate } from "./file-operations";
import { isPdfFile } from "./mime-types";
import { basename } from "./pathUtils";

export const PDF_NOTES_SUFFIX = ".notes";

export type PdfNotesGroup = {
  pdfPath: string;
  notesDirectoryPath: string;
  childPaths: string[];
};

export type ExplorerSnapshot = {
  revision: number;
  items: FileItem[];
  pdfNotesGroups: PdfNotesGroup[];
};

export type CreatePdfNoteRequest = { pdfPath: string; filename: string; content: string };
export type AttachPdfNoteRequest = { pdfPath: string; notePath: string };
export type MovePdfWithNotesRequest = {
  pdfPath: string;
  destinationDirectoryPath: string;
  newFilename?: string;
};
export type ExplorerMovedRoot = { source: string; destination: string };
export type ExplorerRecoveryPath = ExplorerMovedRoot & {
  sourceExists: boolean | null;
  destinationExists: boolean | null;
};
export type ExplorerOperationFailure = {
  success: false;
  error: string;
  errorCode?: "conflict" | "partial";
  recoveryPaths?: ExplorerRecoveryPath[];
  linkUpdates?: NoteLinkUpdate[];
};
export type ExplorerMutationResult<T> = (T | ExplorerOperationFailure) & { revision: number };
export type CreatePdfNoteResult = ExplorerMutationResult<{ success: true; file: FileItem }>;
export type MovePdfNotesResult = ExplorerMutationResult<{
  success: true;
  output: string;
  movedRoots: ExplorerMovedRoot[];
  linkUpdates: NoteLinkUpdate[];
  linkMove: NoteLinkMovePaths;
  updatedLinkCount: number;
}>;

/** Derives relationships without mutating the physical tree or reading note contents. */
export const getPdfNotesGroups = (items: readonly FileItem[]): PdfNotesGroup[] => {
  const groups: PdfNotesGroup[] = [];
  const visit = (siblings: readonly FileItem[]) => {
    const byName = new Map<string, FileItem[]>();
    for (const item of siblings) {
      const name = basename(item.path);
      byName.set(name, [...(byName.get(name) ?? []), item]);
    }
    for (const item of siblings) {
      if (item.isDirectory) {
        visit(item.children ?? []);
        continue;
      }
      if (!isPdfFile(item.mimeType, item.path) || byName.get(basename(item.path))?.length !== 1) continue;
      const companions = byName.get(`${basename(item.path)}${PDF_NOTES_SUFFIX}`);
      const companion = companions?.length === 1 ? companions[0] : undefined;
      if (companion?.isDirectory) {
        groups.push({
          pdfPath: item.path,
          notesDirectoryPath: companion.path,
          childPaths: (companion.children ?? []).map((child) => child.path),
        });
      }
    }
  };
  visit(items);
  return groups;
};
