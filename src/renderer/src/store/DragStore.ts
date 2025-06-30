// store/dragImageStore.ts
import { atom } from "jotai";

export const dragContentAtom = atom<string>("");
export const dragRefAtom = atom<HTMLDivElement | null>(null);
