import { deleteFile, openFile, renameFile } from "@renderer/services/fileService"
import { bookmarksAtom, currentFilePathAtom, editorNoteTextAtom, fileHistoryAtom, fileTreeAtom, isRenamingAtom, newlyCreatedFileAtom, noteTextAtom, openNoteAtom, reloadFlagAtom, renamingFilePathAtom, selectedBreadcrumbAtom } from "../../store/NotesStore"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { FileItem } from "@shared/models";
import { getNotesDirectoryPath } from "@shared/constants";
import { addItemToTree, findFolderNode, generateUniqueName } from "@renderer/services/fileTreeService";
import { addBookmarkToDB, removeBookmarkFromDB } from "../../../utils/bookmarksDB";
import { contextMenuTypeAtom } from "../../store/ContextMenuStore";

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

export const useFileOpen = (): UseFileOpenResult => {
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

export const useFileRemove = (): UseFileRemoveResult => {
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

/**
 * Custom hook to handle file renaming.
 * Differs from other file hooks, as it influences the UI state directly.
 * 
 * @returns {UseFileRenameResult} - Provides functions for renaming a file:
 *   - `startRenaming`: Begins the renaming process for a file.
 *   - `saveRename`: Saves the renamed file and updates the state.
 *   - `isRenaming`: A boolean value indicating whether the renaming process is active.
 */
export const useFileRename = (): UseFileRenameResult => {
    const [isRenaming, setIsRenaming] = useAtom(isRenamingAtom);
    const [renamingFile, setRenamingFile] = useAtom(renamingFilePathAtom);
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);
    const [currentFilePath, setCurrentFilePath] = useAtom(currentFilePathAtom);
    const contextMenuType = useAtomValue(contextMenuTypeAtom);

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
                setCurrentFilePath(result.output || oldFilePath);
            }
        }
    };

    return { isRenaming, startRenaming, saveRename };
};

export const useFileCreate = () => {
    const [files, setFiles] = useAtom(fileTreeAtom);
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);
    const setOpenNote = useSetAtom(openNoteAtom);
    const setNewlyCreatedFile = useSetAtom(newlyCreatedFileAtom);
    const [currentFilename, setCurrentFilename] = useAtom(currentFilePathAtom)
    const [editorNoteText, setEditorNoteText] = useAtom(editorNoteTextAtom)
    const [noteText, setNoteText] = useAtom(noteTextAtom)

    const { startRenaming } = useFileRename()

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

    const createNewFile = async (folderPath: string = getNotesDirectoryPath()) => {
        let filename: string = '';
        let fullFilePath: string = '';

        if (folderPath === getNotesDirectoryPath()) {
            filename = generateUniqueName(files, 'Untitled', '.md');
            fullFilePath = `${folderPath}/${filename}`;
        } else {
            const targetFolder = findFolderNode(files, folderPath);
            if (!targetFolder) {
                console.error(`Folder not found: ${folderPath}`);
                return;
            }

            filename = generateUniqueName(targetFolder.children || [], 'Untitled', '.md');
            fullFilePath = `${folderPath}/${filename}`;
        }

        try {
            await saveCurrentFile()
            await window['api'].saveFile(fullFilePath, '');
            console.log(`File '${filename}' created successfully in '${folderPath}'.`);


            const fileItem: FileItem = {
                filename: filename,
                relativePath: fullFilePath.replace(`${getNotesDirectoryPath()}/`, ''),
                path: fullFilePath,
                isDirectory: false,
            };

            if (folderPath === getNotesDirectoryPath()) 
                setFiles(prevFiles => [...prevFiles, fileItem]);
            else 
                setFiles(prevFiles => addItemToTree(prevFiles, folderPath, fileItem));
            
            setReloadFlag((prev) => !prev);
            setOpenNote(fullFilePath);
            setNewlyCreatedFile(fullFilePath);
            startRenaming(fullFilePath)
        } catch (err) {
            console.error('Error creating file:', err);
        }
    };

    return { createNewFile };
};

export const useDirectoryCreate = () => {
    const [files, setFiles] = useAtom(fileTreeAtom);
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);

    const { startRenaming } = useFileRename()

    const createDirectory = async (folderPath: string = getNotesDirectoryPath()) => {
        let foldername: string = '';
        let fullFolderPath: string = '';
        if (folderPath === getNotesDirectoryPath()) {
            foldername = generateUniqueName(files, 'New directory');
            fullFolderPath = `${folderPath}/${foldername}`;
        } else {
            const targetFolder = findFolderNode(files, folderPath);
            if (!targetFolder) {
                console.error(`Folder not found: ${folderPath}`);
                return;
            }

            foldername = generateUniqueName(targetFolder.children || [], 'New directory');
            fullFolderPath = `${folderPath}/${foldername}`;
        }

        try {
            await window['api'].createDirectory(fullFolderPath);
            console.log(`Folder '${foldername}' created successfully in '${folderPath}'.`);

            const folderItem: FileItem = {
                filename: foldername,
                relativePath: fullFolderPath.replace(`${getNotesDirectoryPath()}/`, ''),
                path: fullFolderPath,
                isDirectory: true,
                children: []
            };
            if (folderPath === getNotesDirectoryPath()) {
                setFiles(prevFiles => [...prevFiles, folderItem]);
            } else {
                setFiles(prevFiles => addItemToTree(prevFiles, folderPath, folderItem));
            }
            setReloadFlag((prev) => !prev);
            startRenaming(fullFolderPath)
        } catch (err) {
            console.error('Error creating folder:', err);
        }
    };

    return { createDirectory };
};

export const useManageFileBookmark = () => {
    const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);

    const addBookmark = (file) => {
        console.log("Hook to add bookmark", file);
        addBookmarkToDB(file);
        setBookmarks([...bookmarks, file]);
    }

    const removeBookmark = (file) => {
        console.log("Hook to remove bookmark", file);
        removeBookmarkFromDB(file);
        setBookmarks(bookmarks.filter(bookmark => bookmark.path !== file.path));
    }

    return { addBookmark, removeBookmark };
}

