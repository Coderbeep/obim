import { atom } from "jotai";

export type FileSavePhase = "dirty" | "saving" | "saved" | "error" | "conflict";

export interface FileSaveState {
  message?: string;
  phase: FileSavePhase;
  savedAt?: number;
}

export const fileSaveStatesByPathAtom = atom<Record<string, FileSaveState>>({});

export interface FileConflictReviewRequest {
  path: string;
}

export const fileConflictReviewRequestAtom = atom<FileConflictReviewRequest | null>(null);

// In-flight disk writes remain owned even if a buffer temporarily compares clean.
export const pendingFileSavePaths = new Set<string>();
