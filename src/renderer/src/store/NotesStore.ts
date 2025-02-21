import { notesDirectoryPath } from '@shared/constants'
import { FileItem } from '@shared/models'
import { atom } from 'jotai'
import { ContextMenuTypes } from '@renderer/components/ContextMenu'

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

// Breadcrumbs related atoms

export const selectedBreadcrumbAtom = atom<string>('');
export const overlayVisibleAtom = atom(false);

// Context menu related atoms

export const contextMenuVisibleAtom = atom(false);
export const contextMenuTypeAtom = atom(ContextMenuTypes.FILE);
export const contextMenuPositionAtom = atom<[number, number]>([0, 0]);
export const contextMenuTargetAtom = atom<FileItem | null>(null);
export const renameCallbackAtom = atom<null | (() => void)>(null);