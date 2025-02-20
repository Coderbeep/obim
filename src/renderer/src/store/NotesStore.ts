import { notesDirectoryPath } from '@shared/constants'
import { FileItem } from '@shared/models'
import { atom } from 'jotai'

export const noteTextAtom = atom('')
export const currentFilePathAtom = atom('')
export const fileHistoryAtom = atom<string[]>([])

export const editorNoteTextAtom = atom('')
export const currentRelativeFilePathAtom = atom((get) => get(currentFilePathAtom).replace(notesDirectoryPath, ''))


// File explorer related atoms

export const fileTreeAtom = atom<FileItem[]>([]);
export const folderCacheAtom = atom<Map<string, FileItem[]>>(new Map());

export const expandedDirectoriesAtom = atom<Set<string>>(new Set<string>());

export const fileLookupAtom = atom<Map<string, FileItem>>(new Map());
export const reloadFlagAtom = atom(false);  // Used to force a reload of the file tree

// Breadcrumbs related atoms

export const selectedBreadcrumbAtom = atom<string>('');
export const overlayVisibleAtom = atom(false);

// Context menu related atoms

export const contextMenuVisibleAtom = atom(false);
export const contextMenuTypeAtom = atom('FILE');
export const contextMenuPositionAtom = atom<[number, number]>([0, 0]);