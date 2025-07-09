import { FileItem } from "@shared/models";
import { atom } from "jotai";

export const fileHistoryBackwardStackAtom = atom<FileItem[]>([]);
export const fileHistoryForwardStackAtom = atom<FileItem[]>([]);