import { memo, useEffect, useRef, useState } from "react";
import { getBookmarksFromDB } from "../../../utils/bookmarksDB";
import { useFileOpen } from "@renderer/hooks/file-actions-hooks/useFileActions";
import { File } from "lucide-react";
import { RenameableFilename } from "./RenameableFilename";
import { useFileContextMenu } from "@renderer/hooks/file-actions-hooks/useFileContextMenu";
import { ContextMenuTypes } from "@shared/constants";
import { useAtom } from "jotai";
import { bookmarksAtom, reloadFlagAtom } from "../../store/NotesStore";

const MemoizedFile = memo(File);

const ListFile = ({ file, openFile }) => {
    const [isRenaming, setIsRenaming] = useState(false);
    const { onContextMenu } = useFileContextMenu(file, ContextMenuTypes.FILEBOOKMARKS)
    const fileRef = useRef<HTMLDivElement>(null);
    const [isHighlighted, setIsHighlighted] = useState(false);

    return (
        <div
            ref={fileRef}
            className={`file-explorer-item flex ${isHighlighted ? "bg-blue-200" : ""}`}
            onClick={() => !isRenaming && openFile(file.path)}
            onContextMenu={onContextMenu}
        >
            <div className="bg-gray-100 p-[0.15rem] rounded-md">
                <MemoizedFile size={14} />
            </div>
            <RenameableFilename
                file={file}
                onRenamingStateChange={setIsRenaming}
                section={ContextMenuTypes.FILEBOOKMARKS}
            />
        </div>
    );
};

export const FileExplorerBookmarks = () => {
    const [bookmarks, setBookmarks] = useAtom(bookmarksAtom);
    const { open } = useFileOpen();
    const [reloadFlag, setReloadFlag] = useAtom(reloadFlagAtom);

    useEffect(() => {
        const fetchBookmarks = async () => {
            const result = await getBookmarksFromDB();
            setBookmarks(result);
            console.log("Bookmarks", result);
        };
        fetchBookmarks();
    }, [reloadFlag])

    return (
        <div>
            <div className="file-explorer-category">
                <span>Pinned</span>
            </div>
            <div className="file-explorer-list pr-4">
                {bookmarks.map((bookmark, index) => (
                    <ListFile
                        key={index}
                        file={bookmark}
                        openFile={open}
                    />
                ))}
            </div>
        </div>

    )
}