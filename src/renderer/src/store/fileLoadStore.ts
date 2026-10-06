import { atom } from "jotai";

export type FileLoadState = { phase: "loading" } | { phase: "error"; message: string };
export const fileLoadStatesByPathAtom = atom<Record<string, FileLoadState>>({});
