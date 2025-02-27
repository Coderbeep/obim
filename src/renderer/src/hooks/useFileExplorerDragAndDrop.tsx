import { moveFile, saveFile } from "@renderer/services/fileService";
import { currentFilePathAtom, editorNoteTextAtom, noteTextAtom, openNoteAtom, reloadFlagAtom } from "../store/NotesStore";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { useFileOpen } from "./file-actions-hooks/useFileActions";

interface useFileExplorerDragAndDropProps {
    targetDirectoryPath: string;
}

export const useFileExplorerDragAndDrop = ({ targetDirectoryPath }: useFileExplorerDragAndDropProps) => {
    const [dragCounter, setDragCounter] = useState(0);
    const noteText = useAtomValue(noteTextAtom)
    const currentFilePath = useAtomValue(currentFilePathAtom)
    const editorNoteText = useAtomValue(editorNoteTextAtom)
    const openNote = useAtomValue(openNoteAtom)
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);
    const { open } = useFileOpen();

    const onDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        setDragCounter((prev) => prev + 1);
    }

    const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
    }

    const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
        event.stopPropagation();

        setDragCounter((prev) => {
            const newCount = prev - 1;
            return newCount < 0 ? 0 : newCount;
        });
    }

    // save the file and then move it (callback)
    const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        setDragCounter(0);
        const fileJSON = JSON.parse(event.dataTransfer.getData('application/json'));
        if (fileJSON.path === currentFilePath) {
            await saveFile(fileJSON.path, editorNoteText);
            const result = await moveFile(fileJSON.path, targetDirectoryPath);
            if (result.output) open(result.output);
        } else {
            await moveFile(fileJSON.path, targetDirectoryPath);
        }

        setReloadFlag(prev => !prev);
    }

    return {
        dragCounter,
        onDragEnter,
        onDragOver,
        onDragLeave,
        onDrop,
    }
}