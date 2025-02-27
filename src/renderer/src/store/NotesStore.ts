import { notesDirectoryPath } from '@shared/constants'
import { FileItem } from '@shared/models'
import { atom } from 'jotai'

// Editor related atoms
export const noteTextAtom = atom('')
export const currentFilePathAtom = atom('')
export const fileHistoryAtom = atom<string[]>([])

export const editorNoteTextAtom = atom('')
export const currentRelativeFilePathAtom = atom((get) => get(currentFilePathAtom).replace(notesDirectoryPath, ''))

// File explorer related atoms
export const fileTreeAtom = atom<FileItem[]>([]);
export const folderCacheAtom = atom<Map<string, FileItem[]>>(new Map());
export const expandedDirectoriesAtom = atom<Set<string>>(new Set<string>());
export const reloadFlagAtom = atom(false);
export const newlyCreatedFileAtom = atom<string>(''); // path to newly created atom

// Breadcrumbs related atoms
export const selectedBreadcrumbAtom = atom<string>('');
export const overlayVisibleAtom = atom(false);

export const isRenamingAtom = atom(false);
export const renamingFilePathAtom = atom<string | null>(null);

// Opening newly created note
export const openNoteAtom = atom(null, (get, set, filePath: string) => {
    set(currentFilePathAtom, filePath)
    set(fileHistoryAtom, [...get(fileHistoryAtom), filePath])
    set(editorNoteTextAtom, '')
    set(noteTextAtom, '')
})

// Bookmarks related atoms
export const bookmarksAtom = atom<FileItem[]>([]);
export const reloadBookmarksFlagAtom = atom(false);