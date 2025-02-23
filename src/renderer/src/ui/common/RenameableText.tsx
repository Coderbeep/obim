import { useFileRename } from "@renderer/hooks/file-actions-hooks/useFileActions";
import { renamingFilePathAtom } from "@renderer/store/NotesStore";
import { FileItem } from "@shared/models";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";

interface RenameableTextProps {
    file: FileItem;
    onRenamingStateChange: (isRenaming: boolean) => void;
}

export const RenameableText = ({ file, onRenamingStateChange }: RenameableTextProps) => {
    const [renamingFile, setRenamingFile] = useAtom(renamingFilePathAtom);
    const editableRef = useRef<HTMLDivElement>(null);
    const { isRenaming, startRenaming, saveRename } = useFileRename();
    
    const isEditing = isRenaming && renamingFile === file.path;
    
    const focusOnEnd = () => {
        setTimeout(() => {
            if (editableRef.current) {
                editableRef.current.focus();
                const range = document.createRange();
                const selection = window.getSelection();
                if (!selection) return;
                range.selectNodeContents(editableRef.current);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }, 0);
    }
    
    const handleStartRenaming = () => {
        startRenaming(file.path);
        focusOnEnd();
    }

    useEffect(() => {
        focusOnEnd();
        onRenamingStateChange(isEditing);
    }, [isEditing]);

    return <div
        ref={editableRef}
        className={`whitespace-nowrap overflow-hidden text-ellipsis flex-1 truncate ${isEditing ? "bg-blue-100 focus:outline-none" : ""}`}
        contentEditable={isEditing}
        spellCheck={false}
        suppressContentEditableWarning={true}
        onBlur={() => saveRename(file.path, editableRef.current?.innerText)}
        onKeyDown={(event) => {
            if (event.key === "Enter") editableRef.current?.blur();
        }}
        onDoubleClick={() => handleStartRenaming()}
    >
        {file.filename}
    </div>
}