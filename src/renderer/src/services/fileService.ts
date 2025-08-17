import { FileItem } from "@shared/models";
import { bookmarkRepository } from "./BookmarkRepository";
import { fileRepository } from "./FileRepository";
import { tryCatch } from "@shared/tryCatch";

export const saveFile = async (
  filename: string,
  content: string,
): Promise<void> => {
  try {
    if (filename != "") {
      await window["api"].saveFile(filename, content);
      console.log(`File '${filename}' saved successfully.`);
    }
  } catch (err) {
    console.error("Error saving file:", err);
  }
};

export const openFile = async (file: FileItem): Promise<string> => {
  const openResult = await tryCatch<string>(window["api"].openFile(file.path));
  if (openResult.error) {
    console.error("Error opening file:", openResult.error);
    throw openResult.error;
  }
  return openResult.data;
};

interface RenameFileResult {
  success: boolean;
  output?: string;
  error?: string;
}

export const renameFile = async (
  filePath: string,
  newFilename: string,
): Promise<RenameFileResult> => {
  try {
    const result = await window["api"].renameFile(filePath, newFilename);
    if (result.success) {
      console.log(
        `File '${filePath}' renamed to '${newFilename}' successfully.`,
      );
      await bookmarkRepository.update(filePath, result.output);
      await fileRepository.update(filePath, result.output);
      return { success: true, output: result.output };
    } else {
      console.log("filePath", filePath);
      console.log("newFilename", newFilename);
      console.log("result.output", result.output);
      console.error(`Error renaming file (inside): ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error("Error renaming file:", err);
    return { success: false, error: String(err) };
  }
};

interface MoveFileResult {
  success: boolean;
  output?: string;
  error?: string;
}

export const moveFile = async (
  sourceFilePath: string,
  targetDirectoryPath: string,
): Promise<MoveFileResult> => {
  try {
    const result = await window["api"].moveFile(
      sourceFilePath,
      targetDirectoryPath,
    );
    if (result.success) {
      console.log(
        `File '${sourceFilePath}' moved to '${targetDirectoryPath}' successfully.`,
      );
      await bookmarkRepository.update(sourceFilePath, result.output);
      await fileRepository.update(sourceFilePath, result.output);
      return { success: true, output: result.output };
    } else {
      console.error(`Error moving file: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (err) {
    console.error("Error moving file:", err);
    return { success: false, error: String(err) };
  }
};

interface RemoveFileResult {
  success: boolean;
  error?: string;
}

export const deleteFile = async (file: FileItem): Promise<RemoveFileResult> => {
  try {
    const result = await window["api"].deleteFile(file.path);
    if (result.success) {
      console.log(`File '${file.path}' deleted successfully.`);
      await bookmarkRepository.delete(file);
      await fileRepository.delete(file);
      return { success: true };
    } else {
      return { success: false, error: result.error };
    }
  } catch (err) {
    return { success: false, error: String(err) };
  }
};

export const createDirectory = async (directoryPath: string): Promise<void> => {
  try {
    await window["api"].createDirectory(directoryPath);
    console.log(`Directory '${directoryPath}' created successfully.`);
  } catch (err) {
    console.error("Error creating directory:", err);
  }
};
