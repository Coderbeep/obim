import { rename } from "fs";

interface RenameableTextProps {
    editableRef: React.RefObject<HTMLDivElement>;
    isEditing: boolean;
    saveRename: () => void;
    startRenaming: () => void;
    filename: string;
}

export const RenameableText = ({ editableRef, isEditing, saveRename, startRenaming, filename }: RenameableTextProps) => {
    return <div
        ref={editableRef}
        className={`truncate ${isEditing ? "bg-blue-100 focus:outline-none" : ""}`}
        contentEditable={isEditing}
        spellCheck={false}
        suppressContentEditableWarning={true}
        onBlur={saveRename}
        onKeyDown={(event) => {
            if (event.key === "Enter") editableRef.current?.blur();
        }}
        onDoubleClick={() => startRenaming()}
    >
        {filename}
    </div>
}