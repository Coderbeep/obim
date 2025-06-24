import { moveFile, saveFile } from "@renderer/services/fileService";
import {
  currentFilePathAtom,
  editorNoteTextAtom,
  reloadFlagAtom,
} from "../store/NotesStore";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useFileOpen } from "./file-actions-hooks/useFileActions";
import { FileItem } from "@shared/models";
import { tryCatch, tryCatchSync } from "@shared/tryCatch";

interface useFileExplorerDragAndDropProps {
  targetDirectoryPath: string;
}

export const useFileExplorerDragAndDrop = ({
  targetDirectoryPath,
}: useFileExplorerDragAndDropProps) => {
  const [dragCounter, setDragCounter] = useState(0);
  const currentFilePath = useAtomValue(currentFilePathAtom);
  const editorNoteText = useAtomValue(editorNoteTextAtom);
  const [, setReloadFlag] = useAtom(reloadFlagAtom);
  const { open } = useFileOpen();

  const onDragEnter = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setDragCounter((prev) => prev + 1);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    setDragCounter((prev) => Math.max(0, prev - 1));
  };

  // save the file and then move it (callback)
  const onDrop = async (
    event: React.DragEvent<HTMLDivElement>,
  ): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    setDragCounter(0);

    const rawData = event.dataTransfer.getData("application/json");
    const parseResult = tryCatchSync(() => JSON.parse(rawData) as FileItem);
    if (parseResult.error) {
      console.error("Invalid drag data: ", parseResult.error);
      return;
    }
    const file = parseResult.data!;
    if (file.path === currentFilePath) {
      const saveResult = await tryCatch(saveFile(file.path, editorNoteText));
      if (saveResult.error) {
        console.error("Failed to save file: ", saveResult.error);
        return;
      }
      console.log("Moving from", file.path, "to", targetDirectoryPath);
      const moveResult = await tryCatch(
        moveFile(file.path, targetDirectoryPath),
      );
      if (moveResult.error) {
        console.error("Failed to move file: ", moveResult.error);
        return;
      }

      if (moveResult.data.output) {
        file.path = moveResult.data.output;
        open(file, true);
      }
    } else {
      const moveResult = await tryCatch(
        moveFile(file.path, targetDirectoryPath),
      );
      if (moveResult.error) {
        console.error("Failed to move file:", moveResult.error);
        return;
      }
    }

    setReloadFlag((prev) => !prev);
  };

  return {
    dragCounter,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
};
