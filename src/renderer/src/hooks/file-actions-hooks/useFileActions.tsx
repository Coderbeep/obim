import { deleteFile, openFile, renameFile } from "@renderer/services/fileService"
import { currentFilePathAtom, editorNoteTextAtom, fileHistoryAtom, isRenamingAtom, noteTextAtom, reloadFlagAtom, renamingFilePathAtom, selectedBreadcrumbAtom } from "@renderer/store/NotesStore"
import { useAtom, useSetAtom } from "jotai"

interface UseFileRemoveResult {
    remove: (path: string) => void;
}
interface UseFileOpenResult {
    open: (filePath: string) => void;
}

interface UseFileRenameResult {
    isRenaming: boolean;
    startRenaming: (filePath: string) => void;
    saveRename: (oldFilePath: string, newName: string) => void;
}


export const useFileRemove = () => {
    const setReloadFlag = useSetAtom(reloadFlagAtom)
    const setSelectedBreadcrumb = useSetAtom(selectedBreadcrumbAtom)
    const [noteText, setNoteText] = useAtom(noteTextAtom)
    const [editorNoteText, setEditorNoteText] = useAtom(editorNoteTextAtom)
    const setCurrentFilePath = useSetAtom(currentFilePathAtom)

    const remove = async (path: string) => {
        const result = await deleteFile(path)
        console.log(result)
        if (result.success) {
            setReloadFlag((prev) => !prev)
            setSelectedBreadcrumb('')
            setNoteText('')
            setEditorNoteText('')
            setCurrentFilePath('')
        }
    }

    return { remove }
}


export const useFileOpen = () => {
    const [noteText, setNoteText] = useAtom(noteTextAtom)
    const [fileHistory, setFileHistory] = useAtom(fileHistoryAtom)
    const [currentFilename, setCurrentFilename] = useAtom(currentFilePathAtom)
    const [editorNoteText, setEditorNoteText] = useAtom(editorNoteTextAtom)

    const saveCurrentFile = async () => {
        if (currentFilename) {
            try {
                await window['api'].saveFile(currentFilename, editorNoteText)
                setNoteText(editorNoteText)
            } catch (err) {
                console.error('Error saving file:', err);
            }
        }
    }

    const open = async (filePath: string) => {
        try {
            await saveCurrentFile();
            const result = await openFile(filePath)

            setFileHistory([...fileHistory, filePath])
            setNoteText(result);
            setEditorNoteText(result);
            setCurrentFilename(filePath)
        } catch (err) {
            console.error('Error opening file:', err);
        }
    }

    return { open }
}

/**
 * Custom hook to handle file renaming.
 * 
 * @returns {UseFileRenameResult} - Provides functions for renaming a file:
 *   - `startRenaming`: Begins the renaming process for a file.
 *   - `saveRename`: Saves the renamed file and updates the state.
 *  - `isRenaming`: A boolean value indicating whether the renaming process is active.
 */

export const useFileRename = (): UseFileRenameResult => {
    const [isRenaming, setIsRenaming] = useAtom(isRenamingAtom);
    const [renamingFile, setRenamingFile] = useAtom(renamingFilePathAtom);
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);
    const [currentFilePath, setCurrentFilePath] = useAtom(currentFilePathAtom);

    const startRenaming = (filePath: string) => {
        if (!filePath) return;
        setRenamingFile(filePath);
        setIsRenaming(true);
    };

    const saveRename = async (oldFilePath: string, newName: string) => {
        setIsRenaming(false);

        if (newName === oldFilePath) return;

        const result = await renameFile(oldFilePath, newName);
        if (!result.success) {
            console.error("Renaming failed");
        } else {
            setReloadFlag((prev) => !prev);
            if (currentFilePath === oldFilePath) {
                setCurrentFilePath(result.output);
            }
        }
    };

    return { isRenaming, startRenaming, saveRename };
};