import { renameFile } from "@renderer/services/fileService";
import { currentFilePathAtom, reloadFlagAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import { useState } from "react";

export const useRenameFile = ({file, editableRef}) => {
    const [ isEditing, setIsEditing ] = useState(false);
    const [ reloadFlag, setReloadFlag ] = useAtom(reloadFlagAtom);
    const [ currentFilePath, setCurrentFilePath ] = useAtom(currentFilePathAtom);
    
    const startRenaming = () => {
        setIsEditing(true); 
        setTimeout(() => {
            editableRef.current?.focus();

            const range = document.createRange();
            const selection = window.getSelection();
            if (selection && editableRef.current) {
                range.selectNodeContents(editableRef.current);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }, 0);
    }

    const saveRename = async () => {
        setIsEditing(false);
        const newName = editableRef.current?.innerText.trim();
    
        if (newName && newName !== file.filename) {
            const result = await renameFile(file.path, newName);
            if (!result.success) {
                editableRef.current.innerText = file.filename;
            } else {
                setReloadFlag((prev) => !prev);
                if (currentFilePath === file.path) {
                    setCurrentFilePath(result.output);
                }
            }
        } else {
            editableRef.current.innerText = file.filename;
        }
    };

    return { isEditing, saveRename, startRenaming };
}