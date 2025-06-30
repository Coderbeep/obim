import { getNotesDirectoryPath } from "@shared/constants";
import { FileItem } from "@shared/models";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

// Editor-wide config
export const isInitializedAtom = atom(false);

// Editor related atoms
export const noteTextAtom = atom("");
export const currentFilePathAtom = atom("");
export const isActiveFileAtomFamily = atomFamily(
  (filePath: string) =>
    atom(
      (get) => get(currentFilePathAtom) === filePath,
      () => {}
    ),
  (a, b) => a === b
);

export const dragCounterAtomFamily = atomFamily(
  (directoryPath: string) => atom(0),
  (a, b) => a === b
);


export const fileHistoryAtom = atom<string[]>([]);

export const editorNoteTextAtom = atom("");
export const currentRelativeFilePathAtom = atom((get) =>
  get(currentFilePathAtom).replace(getNotesDirectoryPath(), "")
);



// File explorer related atoms
export const fileTreeAtom = atom<FileItem[]>([]);
export const expandedDirectoriesAtom = atom<Set<string>>(new Set<string>());

export const isDirectoryExpandedAtomFamily = atomFamily((path: string) =>
  atom((get) => get(expandedDirectoriesAtom).has(path))
);

export const reloadFlagAtom = atom(false);
export const newlyCreatedFileAtom = atom<string>(""); // path to newly created atom

// Breadcrumbs related atoms
export const selectedBreadcrumbAtom = atom<string>("");
export const selectedBredcrumbMatchAtomFamily = atomFamily((path: string) => 
  atom((get) => get(selectedBreadcrumbAtom) === path)
);


export const overlayVisibleAtom = atom(false);

export const isRenamingAtom = atom(false);
export const renamingFilePathAtom = atom<string | null>(null);
export const renamingStateFamily = atomFamily((filePath: string) => atom(false))

// Opening newly created note
export const openNoteAtom = atom(null, (get, set, filePath: string) => {
  set(currentFilePathAtom, filePath);
  set(fileHistoryAtom, [...get(fileHistoryAtom), filePath]);
  set(editorNoteTextAtom, "");
  set(noteTextAtom, "");
});

// Bookmarks related atoms
export const bookmarksAtom = atom<FileItem[]>([]);
export const reloadBookmarksFlagAtom = atom(false);
