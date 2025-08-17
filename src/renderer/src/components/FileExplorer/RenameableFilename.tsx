import { useFileRename } from "@renderer/hooks/file-actions-hooks/useFileActions";
import { renamingStateFamily } from "@renderer/store/NotesStore";
import { ContextMenuTypes } from "@shared/constants";
import { FileItem } from "@shared/models";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useRef } from "react";

interface RenameableTextProps {
  file: FileItem;
  onRenamingStateChange: (isRenaming: boolean) => void;
  section?: ContextMenuTypes;
}

export const RenameableFilename = ({
  file,
  onRenamingStateChange,
}: RenameableTextProps) => {
  const isEditing = useAtomValue(renamingStateFamily(file.path))
  const editableRef = useRef<HTMLDivElement>(null);
  const { saveRename, stopRenaming } = useFileRename();

  const focusOnEnd = useCallback(() => {
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
  }, []);

  useEffect(() => {
    if (isEditing) {
      focusOnEnd()
    }
  }, [isEditing, focusOnEnd])

  useEffect(() => {
    onRenamingStateChange(isEditing);
  }, [isEditing, onRenamingStateChange]);

  const handleBlur = useCallback(() => {
    saveRename(file.path, editableRef.current?.innerText || "");
    stopRenaming(file.path)
  }, [file.path]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Escape") {
      editableRef.current?.blur();
    }
  }, []);

  return (
    <div
      ref={editableRef}
      className={`rounded-[var(--radius)] px-1 whitespace-nowrap overflow-hidden text-sm text-ellipsis flex-1 truncate ${
        isEditing ? "bg-blue-100 focus:outline-none" : ""
      }`}
      contentEditable={isEditing}
      spellCheck={false}
      suppressContentEditableWarning={true}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {file.filename}
    </div>
  );
};
