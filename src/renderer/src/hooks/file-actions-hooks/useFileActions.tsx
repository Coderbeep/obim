import {
  deleteFile,
  openFile,
  renameFile,
} from "@renderer/services/fileService";
import {
  bookmarksAtom,
  currentFileAtom,
  currentFilePathAtom,
  editorNoteTextAtom,
  fileTreeAtom,
  isRenamingAtom,
  noteTextAtom,
  openNoteAtom,
  reloadFlagAtom,
  renamingFilePathAtom,
  renamingStateFamily,
  selectedBreadcrumbAtom,
} from "../../store/NotesStore";
import {
  fileHistoryBackwardStackAtom,
  fileHistoryForwardStackAtom,
} from "@renderer/store/FileNavigationStore";
import { useAtom, useSetAtom, useStore } from "jotai";
import { FileItem } from "@shared/models";
import { getNotesDirectoryPath } from "@shared/constants";
import {
  addItemToTree,
  findFolderNode,
  generateUniqueName,
} from "@renderer/services/fileTreeService";
import { bookmarkRepository } from "@renderer/services/BookmarkRepository";
import { useCallback, useEffect } from "react";
import { set } from "lodash";

interface UseFileRemoveResult {
  remove: (file: FileItem) => void;
}

interface OpenFileOptions {
  skipSave?: boolean;
  skipForwardHistoryClear?: boolean;
}
interface UseFileOpenResult {
  open: (file: FileItem, options?: OpenFileOptions) => void;
}

interface UseFileRenameResult {
  startRenaming: (filePath: string) => void;
  saveRename: (oldFilePath: string, newName: string) => void;
  stopRenaming: (filePath: string) => void;
}

export const useFileOpen = (): UseFileOpenResult => {
  const store = useStore();

  // --- State Access ---
  const currentFileState = {
    get: () => store.get(currentFileAtom),
    set: (file: FileItem | null) => store.set(currentFileAtom, file),
  }

  const filenameState = {
    get: () => store.get(currentFilePathAtom),
    set: (value: string) => store.set(currentFilePathAtom, value),
  };

  const noteState = {
    getEditor: () => store.get(editorNoteTextAtom),
    setEditor: (value: string) => store.set(editorNoteTextAtom, value),
    setSaved: (value: string) => store.set(noteTextAtom, value),
  };

  const history = {
    pushBack: (file: FileItem) => {
      const stack = store.get(fileHistoryBackwardStackAtom);
      const last = stack[stack.length - 1];
      if (last?.path === file.path) return;
      store.set(fileHistoryBackwardStackAtom, [...stack, file]);
    },
    clearForward: () => store.set(fileHistoryForwardStackAtom, []),
  };

  // --- File Persistence ---
  const saveCurrentFile = useCallback(async () => {
    const filename = filenameState.get();
    const content = noteState.getEditor();

    if (!filename) return;
    try {
      await window["api"].saveFile(filename, content);
      noteState.setSaved(content);
    } catch (err) {
      console.error("Error saving file:", err);
    }
  }, []);


  const open = useCallback(
    async (file: FileItem, options?: OpenFileOptions) => {
      let { skipSave = false, skipForwardHistoryClear = false } = options ?? {};

      if (currentFileState.get()?.mimeType?.startsWith('image/')) {
        skipSave = true; 
      }

      try {
        if (!skipSave) await saveCurrentFile();
        if (!skipForwardHistoryClear) history.clearForward();

        const content = await openFile(file);

        history.pushBack(file);
        noteState.setEditor(content);
        noteState.setSaved(content);
        filenameState.set(file.path);
        currentFileState.set(file);
      } catch (err) {
        console.error("Error opening file:", err);
      }
    },
    [saveCurrentFile]
  );

  return { open };
};

export const useFileRemove = (): UseFileRemoveResult => {
  const setReloadFlag = useSetAtom(reloadFlagAtom);
  const setSelectedBreadcrumb = useSetAtom(selectedBreadcrumbAtom);
  const [, setNoteText] = useAtom(noteTextAtom);
  const [, setEditorNoteText] = useAtom(editorNoteTextAtom);
  const setCurrentFilePath = useSetAtom(currentFilePathAtom);

  useEffect(() => {
    console.log("[RENDER] useFileRemove");
  });

  const remove = async (file: FileItem) => {
    const result = await deleteFile(file);
    console.log(result);
    if (result.success) {
      setReloadFlag((prev) => !prev);
      setSelectedBreadcrumb("");
      setNoteText("");
      setEditorNoteText("");
      setCurrentFilePath("");
    }
  };

  return { remove };
};

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
  const store = useStore();

  const currentFilePath = store.get(currentFilePathAtom);
  const setCurrentFilePath = (value: string) =>
    store.set(currentFilePathAtom, value);

  const [, setIsRenaming] = useAtom(isRenamingAtom);
  const [, setRenamingFile] = useAtom(renamingFilePathAtom);

  const startRenaming = (filePath: string) => {
    if (!filePath) return;
    console.log("start renaming");
    setRenamingFile(filePath);
    store.set(renamingStateFamily(filePath), true);
    setIsRenaming(true);
  };

  const saveRename = async (oldFilePath: string, newName: string) => {
    setIsRenaming(false);
    store.set(renamingStateFamily(oldFilePath), false);
    setRenamingFile(null);

    if (newName === oldFilePath) return;

    const result = await renameFile(oldFilePath, newName);
    if (!result.success) {
      console.error("Renaming failed");
    } else {
      if (currentFilePath === oldFilePath) {
        setCurrentFilePath(result.output || oldFilePath);
      }
    }
  };

  const stopRenaming = (filePath: string) => {
    setIsRenaming(false);
    store.set(renamingStateFamily(filePath), false);
    setRenamingFile(null);
  };

  return { startRenaming, saveRename, stopRenaming };
};

export const useFileCreate = () => {
  const store = useStore();
  const getFiles = () => store.get(fileTreeAtom);
  const setFiles = (value: FileItem[]) => store.set(fileTreeAtom, value);
  const setReloadFlag = (value: boolean) => store.set(reloadFlagAtom, value);
  const setOpenNote = (value: FileItem) => store.set(openNoteAtom, value);
  const getCurrentFilename = () => store.get(currentFilePathAtom);
  const getEditorNoteText = () => store.get(editorNoteTextAtom);
  const setNoteText = (value: string) => store.set(noteTextAtom, value);

  const saveCurrentFile = async () => {
    const currentFilename = getCurrentFilename();
    const editorNoteText = getEditorNoteText();

    if (currentFilename) {
      try {
        await window["api"].saveFile(currentFilename, editorNoteText);
        setNoteText(editorNoteText);
      } catch (err) {
        console.error("Error saving file:", err);
      }
    }
  };

  const createNewFile = async (
    folderPath: string = getNotesDirectoryPath()
  ) => {
    let filename: string = "";
    let fullFilePath: string = "";
    const files = getFiles();

    if (folderPath === getNotesDirectoryPath()) {
      filename = generateUniqueName(files, "Untitled", ".md");
      fullFilePath = `${folderPath}/${filename}`;
    } else {
      const targetFolder = findFolderNode(files, folderPath);
      if (!targetFolder) {
        console.error(`Folder not found: ${folderPath}`);
        return;
      }

      filename = generateUniqueName(
        targetFolder.children || [],
        "Untitled",
        ".md"
      );
      fullFilePath = `${folderPath}/${filename}`;
    }

    try {
      await saveCurrentFile();
      await window["api"].saveFile(fullFilePath, "");
      console.log(
        `File '${filename}' created successfully in '${folderPath}'.`
      );

      const fileItem: FileItem = {
        filename: filename,
        relativePath: fullFilePath.replace(`${getNotesDirectoryPath()}/`, ""),
        path: fullFilePath,
        isDirectory: false,
        mimeType: "text/markdown",
      };

      if (folderPath === getNotesDirectoryPath())
        setFiles([...files, fileItem]);
      else setFiles(addItemToTree(files, folderPath, fileItem));

      setReloadFlag((prev) => !prev);
      setOpenNote(fileItem);
    } catch (err) {
      console.error("Error creating file:", err);
    }
  };

  return { createNewFile };
};

export const useDirectoryCreate = () => {
  const [files, setFiles] = useAtom(fileTreeAtom);
  const [, setReloadFlag] = useAtom(reloadFlagAtom);

  const { startRenaming } = useFileRename();

  const createDirectory = async (
    folderPath: string = getNotesDirectoryPath()
  ) => {
    let foldername: string = "";
    let fullFolderPath: string = "";
    if (folderPath === getNotesDirectoryPath()) {
      foldername = generateUniqueName(files, "New directory");
      fullFolderPath = `${folderPath}/${foldername}`;
    } else {
      const targetFolder = findFolderNode(files, folderPath);
      if (!targetFolder) {
        console.error(`Folder not found: ${folderPath}`);
        return;
      }

      foldername = generateUniqueName(
        targetFolder.children || [],
        "New directory"
      );
      fullFolderPath = `${folderPath}/${foldername}`;
    }

    try {
      await window["api"].createDirectory(fullFolderPath);
      console.log(
        `Folder '${foldername}' created successfully in '${folderPath}'.`
      );

      const folderItem: FileItem = {
        filename: foldername,
        relativePath: fullFolderPath.replace(`${getNotesDirectoryPath()}/`, ""),
        path: fullFolderPath,
        isDirectory: true,
        children: [],
      };
      if (folderPath === getNotesDirectoryPath()) {
        setFiles((prevFiles) => [...prevFiles, folderItem]);
      } else {
        setFiles((prevFiles) =>
          addItemToTree(prevFiles, folderPath, folderItem)
        );
      }
      setReloadFlag((prev) => !prev);
      startRenaming(fullFolderPath);
    } catch (err) {
      console.error("Error creating folder:", err);
    }
  };

  return { createDirectory };
};

export const useManageFileBookmark = () => {
  const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);

  const addBookmark = (file) => {
    console.log("Hook to add bookmark", file);
    bookmarkRepository.create(file);
    setBookmarks([...bookmarks, file]);
  };

  const removeBookmark = (file) => {
    console.log("Hook to remove bookmark", file);
    bookmarkRepository.delete(file);
    setBookmarks(bookmarks.filter((bookmark) => bookmark.path !== file.path));
  };

  return { addBookmark, removeBookmark };
};
