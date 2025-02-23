import { reloadFlagAtom } from "../store/NotesStore";
import { FileItem } from "@shared/models";
import { useAtom } from "jotai";
import { useState } from "react";

interface useFileExplorerDragAndDropProps {
    onDropCallback: (file: FileItem) => void;
}

export const useFileExplorerDragAndDrop = ({ onDropCallback }: useFileExplorerDragAndDropProps) => {
    const [dragCounter, setDragCounter] = useState(0);
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);

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

    const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        setDragCounter(0);

        const fileJSON = event.dataTransfer.getData('application/json');
        onDropCallback(JSON.parse(fileJSON));
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