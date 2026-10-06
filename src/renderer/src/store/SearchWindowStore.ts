import { FileItem } from "@shared/file-item";
import { atom } from "jotai";

export const isVisibleAtom = atom(false);

export type SearchScope = "files" | "images" | "links";

export const searchResultsAtom = atom<Record<SearchScope, FileItem[]>>({
  files: [],
  images: [],
  links: [],
});
