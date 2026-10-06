import { atom } from "jotai";

/** Counts in-flight project writes, including retries, to guard concurrent multi-file mutations. */
export const taskBoardProjectMutationCountAtom = atom(0);
