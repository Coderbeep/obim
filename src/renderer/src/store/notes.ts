import { notesDirectoryPath } from '@shared/constants'
import { atom } from 'jotai'

export const noteTextAtom = atom('')
export const currentFilePathAtom = atom('')
export const fileHistoryAtom = atom<string[]>([])

export const editorNoteTextAtom = atom('')
export const currentRelativeFilePathAtom = atom((get) => get(currentFilePathAtom).replace(notesDirectoryPath, ''))