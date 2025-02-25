export const saveFile = async (filaname: string, content: string): Promise<void> => {
    try {
        await window['api'].saveFile(filaname, content);
        console.log(`File '${filaname}' saved successfully.`);
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
            return { success: true };
        } else {
            console.error(`Error deleting file: ${result.error}`);
            return { success: false, error: result.error }
        }
    } catch (err) {
        console.error('Error deleting file:', err);
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