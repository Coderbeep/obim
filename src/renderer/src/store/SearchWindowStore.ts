import { FileItem } from "@shared/models";
import { atom } from "jotai";

export const isVisibleAtom = atom(false);
export const queryAtom = atom("");
export const resultsAtom = atom<FileItem[]>([]);
