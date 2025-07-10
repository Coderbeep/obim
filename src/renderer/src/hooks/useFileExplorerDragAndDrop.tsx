import { moveFile, saveFile } from "@renderer/services/fileService";
import {
  currentFilePathAtom,
  dragCounterAtomFamily,
  editorNoteTextAtom,
  reloadFlagAtom,
} from "../store/NotesStore";
import { dragContentAtom, dragRefAtom } from "../store/DragStore";
import { useAtom, useStore } from "jotai";
import { useFileOpen } from "./file-actions-hooks/useFileActions";
import { FileItem } from "@shared/models";
import { tryCatch, tryCatchSync } from "@shared/tryCatch";

/**
 * Hook for setting up drag source behavior on a file or directory.
 * Interacts with GlobalDrag to prepare preview of the drag.
 */
export const useFileExplorerDragSource = (file: FileItem) => {
  const store = useStore();
  const dragImageRef = store.get(dragRefAtom);
  const setDragContent = (content: string) =>
    store.set(dragContentAtom, content);

  const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("application/json", JSON.stringify(file));
    setDragContent(file.filename);
    event.dataTransfer.setDragImage(new Image(), 0, 0);
    if (dragImageRef) {
      dragImageRef.style.display = "flex";
    }
  };

  const onDrag = (event: React.DragEvent<HTMLDivElement>) => {
    if (dragImageRef) {
      dragImageRef.style.position = "fixed";
      dragImageRef.style.left = `${event.pageX + 10}px`;
      dragImageRef.style.top = `${event.pageY + 5}px`;
    }
  };

  const onDragEnd = () => {
    if (dragImageRef) {
      Object.assign(dragImageRef.style, {
        display: "none",
        left: `-200px`,
        top: `-200px`,
      });
    }
  };

  return { onDragStart, onDrag, onDragEnd };
};

/**
 * Hook for handling drop targets. Used by the FileExplorer
 * and ListDirectory elements.
 */

export const useFileExplorerDropTarget = (targetDirectoryPath: string) => {
  const store = useStore();
  const [dragCounter, setDragCounter] = useAtom(
    dragCounterAtomFamily(targetDirectoryPath)
  );

  const setReloadFlag = (flag: boolean) => store.set(reloadFlagAtom, flag);
  const { open } = useFileOpen();

  const onDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragCounter((prev) => prev + 1);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    setDragCounter((prev) => Math.max(0, prev - 1));
  };

  const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragCounter(0);

    const rawData = event.dataTransfer.getData("application/json");
    const parseResult = tryCatchSync(() => JSON.parse(rawData) as FileItem);
    if (parseResult.error) {
      console.error("Invalid drag data: ", parseResult.error);
      return;
    }

    const draggedFile = parseResult.data!;
    const currentFilePath = store.get(currentFilePathAtom);
    const editorNoteText = store.get(editorNoteTextAtom);

    if (draggedFile.path === currentFilePath) {
      const saveResult = await tryCatch(
        saveFile(draggedFile.path, editorNoteText)
      );
      if (saveResult.error) {
        console.error("Failed to save file: ", saveResult.error);
        return;
      }
    }

    const moveResult = await tryCatch(
      moveFile(draggedFile.path, targetDirectoryPath)
    );

    if (moveResult.error) {
      console.error("Failed to move file:", moveResult.error);
      return;
    }

    if (draggedFile.path === currentFilePath && moveResult.data.output) {
      draggedFile.path = moveResult.data.output;
      open(draggedFile, {skipSave: true} );
    }

    setReloadFlag(!store.get(reloadFlagAtom));
  };

  return {
    dragCounter,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
};
