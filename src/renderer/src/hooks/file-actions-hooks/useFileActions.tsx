import { deleteFile, openFile, renameFile } from "@renderer/services/fileService"
import { currentFilePathAtom, editorNoteTextAtom, fileHistoryAtom, fileTreeAtom, isRenamingAtom, noteTextAtom, reloadFlagAtom, renamingFilePathAtom, selectedBreadcrumbAtom } from "../../store/NotesStore"
import { useAtom, useSetAtom } from "jotai"
import { FileItem } from "@shared/models";
import { notesDirectoryPath } from "@shared/constants";

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
                setCurrentFilePath(result.output || oldFilePath);
            }
        }
    };

    return { isRenaming, startRenaming, saveRename };
};

export const useFileCreate = () => {
    const [files, setFiles] = useAtom(fileTreeAtom);

    const findFolderNode = (tree: FileItem[], folderPath: string): FileItem | null => {
        for (const node of tree) {
            if (node.isDirectory && node.path === folderPath) {
                return node;
            }
            if (node.isDirectory && node.children) {
                const found = findFolderNode(node.children, folderPath);
                if (found) return found;
            }
        }
        return null;
    };

    const generateUniqueFileName = (folder: FileItem): string => {
        const existingFiles = folder.children?.filter(child => !child.isDirectory && child.filename.startsWith('Untitled')) || [];
        let untitledNum = 1;
        while (existingFiles.some(file => file.filename === `Untitled ${untitledNum}.md`)) {
            untitledNum++;
        }
        return `Untitled ${untitledNum}.md`;
    };

    const addFileToTree = (tree: FileItem[], folderPath: string, newFile: FileItem): FileItem[] => {
        return tree.map(node => {
            if (node.isDirectory && node.path === folderPath) {
                return {
                    ...node,
                    children: [...(node.children || []), newFile]
                };
            }
            if (node.isDirectory && node.children) {
                return {
                    ...node,
                    children: addFileToTree(node.children, folderPath, newFile)
                };
            }
            return node;
        });
    };

    const createNewFile = async (folderPath: string = notesDirectoryPath) => {
        const targetFolder = findFolderNode(files, folderPath);
        if (!targetFolder) {
            console.error(`Folder not found: ${folderPath}`);
            return;
        }

        const filename = generateUniqueFileName(targetFolder);
        const fullFilePath = `${folderPath}/${filename}`;

        try {
            await window['api'].saveFile(fullFilePath, '');
            console.log(`File '${filename}' created successfully in '${folderPath}'.`);

            const fileItem: FileItem = {
                filename: filename,
                relativePath: fullFilePath.replace(`${notesDirectoryPath}/`, ''),
                path: fullFilePath,
                isDirectory: false,
            };

            setFiles(prevFiles => addFileToTree(prevFiles, folderPath, fileItem));
        } catch (err) {
            console.error('Error creating file:', err);
        }
    };

    return { createNewFile };
};

export const useDirectoryCreate = () => {
    const [files, setFiles] = useAtom(fileTreeAtom);

    const findFolderNode = (tree: FileItem[], folderPath: string): FileItem | null => {
        for (const node of tree) {
            if (node.isDirectory && node.path === folderPath) {
                return node;
            }
            if (node.isDirectory && node.children) {
                const found = findFolderNode(node.children, folderPath);
                if (found) return found;
            }
        }
        return null;
    };

    const generateUniqueFolderName = (folder: FileItem): string => {
        const existingFolders = folder.children?.filter(child => child.isDirectory && child.filename.startsWith('New Folder')) || [];
        let folderNum = 1;
        while (existingFolders.some(folder => folder.filename === `New Folder ${folderNum}`)) {
            folderNum++;
        }
        return `New Folder ${folderNum}`;
    };

    const addFolderToTree = (tree: FileItem[], folderPath: string, newFolder: FileItem): FileItem[] => {
        return tree.map(node => {
            if (node.isDirectory && node.path === folderPath) {
                return {
                    ...node,
                    children: [...(node.children || []), newFolder]
                };
            }
            if (node.isDirectory && node.children) {
                return {
                    ...node,
                    children: addFolderToTree(node.children, folderPath, newFolder)
                };
            }
            return node;
        });
    };

    const createDirectory = async (folderPath: string = notesDirectoryPath) => {
        const targetFolder = findFolderNode(files, folderPath);
        if (!targetFolder) {
            console.error(`Folder not found: ${folderPath}`);
            return;
        }

        const foldername = generateUniqueFolderName(targetFolder);
        const fullFolderPath = `${folderPath}/${foldername}`;

        try {
            await window['api'].createDirectory(fullFolderPath);
            console.log(`Folder '${foldername}' created successfully in '${folderPath}'.`);

            const folderItem: FileItem = {
                filename: foldername,
                relativePath: fullFolderPath.replace(`${notesDirectoryPath}/`, ''),
                path: fullFolderPath,
                isDirectory: true,
                children: []
            };

            setFiles(prevFiles => addFolderToTree(prevFiles, folderPath, folderItem));
        } catch (err) {
            console.error('Error creating folder:', err);
        }
    };

    return { createDirectory };
};
