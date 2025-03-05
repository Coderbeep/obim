import { addBookmarkToDB, removeBookmarkFromDB, updateBookmarkInDB } from "../../utils/bookmarksDB";

export const saveFile = async (filename: string, content: string): Promise<void> => {
    try {
        if (filename != '') {
            await window['api'].saveFile(filename, content);
            console.log(`File '${filename}' saved successfully.`);
        }

    } catch (err) {
        console.error('Error saving file:', err);
    }
}

export const openFile = async (filePath: string): Promise<string> => {
    try {
        return await window['api'].openFile(filePath);
    } catch (err) {
        console.error('Error opening file:', err);
        throw err
    }
}

interface RenameFileResult {
    success: boolean;
    output?: string;
    error?: string;
}

export const renameFile = async (filePath: string, newFilename: string): Promise<RenameFileResult> => {
    try {
        const result = await window['api'].renameFile(filePath, newFilename);
        if (result.success) {
            console.log(`File '${filePath}' renamed to '${newFilename}' successfully.`);
            await updateBookmarkInDB(filePath, result.output);
            return { success: true, output: result.output };
        } else {
            console.error(`Error renaming file: ${result.error}`);
            return { success: false, error: result.error };
        }
    } catch (err) {
        console.error('Error renaming file:', err);
        return { success: false, error: String(err) };
    }
};

interface MoveFileResult {
    success: boolean;
    output?: string;
    error?: string;
}

export const moveFile = async (sourceFilePath: string, targetDirectoryPath: string): Promise<MoveFileResult> => {
    try {
        const result = await window['api'].moveFile(sourceFilePath, targetDirectoryPath);
        if (result.success) {
            console.log(`File '${sourceFilePath}' moved to '${targetDirectoryPath}' successfully.`);
            await updateBookmarkInDB(sourceFilePath, result.output)
            return { success: true, output: result.output };
        } else {
            console.error(`Error moving file: ${result.error}`);
            return { success: false, error: result.error };
        }
    } catch (err) {
        console.error('Error moving file:', err);
        return { success: false, error: String(err) };
    }
}

interface RemoveFileResult {
    success: boolean;
    error?: string; 
}

export const deleteFile = async (filePath: string): Promise<RemoveFileResult> => {
    try {
        const result = await window['api'].deleteFile(filePath);
        if (result.success) {
            console.log(`File '${filePath}' deleted successfully.`);
            await removeBookmarkFromDB(filePath);
            return { success: true };
        } else {
            return { success: false, error: result.error }
        }
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export const createDirectory = async (directoryPath: string): Promise<void> => {
    try {
        await window['api'].createDirectory(directoryPath);
        console.log(`Directory '${directoryPath}' created successfully.`);
    } catch (err) {
        console.error('Error creating directory:', err);
    }
}