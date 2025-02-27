import { useFileRename } from "@renderer/hooks/file-actions-hooks/useFileActions";
import { renamingFilePathAtom } from "../../store/NotesStore";
import { FileItem } from "@shared/models";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { ContextMenuTypes } from "@shared/constants";
import { contextMenuTypeAtom } from "@renderer/store/ContextMenuStore";

interface RenameableTextProps {
    file: FileItem;
    onRenamingStateChange: (isRenaming: boolean) => void;
    section?: ContextMenuTypes;
}

export const RenameableFilename = ({ file, onRenamingStateChange, section }: RenameableTextProps) => {
    const [renamingFilePath, setRenamingFilePath] = useAtom(renamingFilePathAtom);
    const editableRef = useRef<HTMLDivElement>(null);
    const { isRenaming, saveRename } = useFileRename();
    const [isRenamingSection, setIsRenamingSection] = useAtom(contextMenuTypeAtom);
    const currentSection = section || ContextMenuTypes.FILE;

    const isEditing = isRenaming &&
        renamingFilePath === file.path &&
        isRenamingSection === currentSection;

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

    useEffect(() => {
        focusOnEnd();
        onRenamingStateChange(isEditing);
    }, [isEditing]);

    return <div
        ref={editableRef}
        className={`whitespace-nowrap overflow-hidden text-sm text-ellipsis flex-1 truncate ${isEditing ? "bg-blue-100 focus:outline-none" : ""}`}
        contentEditable={isEditing}
        spellCheck={false}
        suppressContentEditableWarning={true}
        onBlur={() => saveRename(file.path, editableRef.current?.innerText || "")}
        onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "Escape") editableRef.current?.blur();
        }}
    >
        {file.filename}
    </div>
}