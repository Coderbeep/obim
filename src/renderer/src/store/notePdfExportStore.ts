import { atom } from "jotai";
import type { FileItem } from "@shared/file-item";

export const notePdfExportRequestAtom = atom<FileItem | null>(null);
