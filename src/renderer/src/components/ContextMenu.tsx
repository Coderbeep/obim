import { useManageFileBookmark, useDirectoryCreate, useFileCreate, useFileOpen, useFileRemove, useFileRename } from "@renderer/hooks/file-actions-hooks/useFileActions";
import { contextMenuPositionAtom, contextMenuTargetAtom, contextMenuTypeAtom, contextMenuVisibleAtom } from "../store/ContextMenuStore";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { AppSections, ContextMenuTypes } from "@shared/constants";
import { FilePlus, FolderPlus, PenLine, Trash2, FileText, Bookmark, BookmarkX } from "lucide-react"

const ContextMenuSeparator = () => (
    <div className="border-t border-gray-200 my-1 mx-2" />
);

const ContextMenuItem = ({ icon: Icon, label, onClick, className = "" }) => (
    <div
        className={`flex items-center gap-2 px-2 mx-2 rounded-md py-[0.5px] cursor-pointer hover:bg-gray-100 ${className}`}
        onClick={onClick}
    >
        <Icon className={`w-[16px] h-[16px] text-gray-600 ${className}`} />
        <span className={`text-gray-800 text-[13px] ${className || ""}`}> {label} </span>
    </div>
);

const ContextMenuFile = ({ target }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    const { open } = useFileOpen();
    const { remove } = useFileRemove();
    const { startRenaming } = useFileRename();
    const { addBookmark } = useManageFileBookmark();

    const actions = [
        { label: "Open", icon: FileText, action: () => open(target.path) },
        { label: "Rename", icon: PenLine, action: () => startRenaming(target.path, AppSections.FILE_EXPLORER_FILES) },
        { separator: true },
        { label: "Add bookmark", icon: Bookmark, action: () => addBookmark(target) },
        { separator: true },
        { label: "Delete", icon: Trash2, action: () => remove(target.path), className: "text-red-500 hover:bg-red-50" }
    ];

    const handleOnClick = (action) => {
        action();
        setContextMenuVisible(false);
    }

    return actions.map((item, index) =>
        item.separator ? (
            <ContextMenuSeparator key={`separator-${index}`} />
        ) : (
            <ContextMenuItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleOnClick(item.action)} className={item.className} />
        )
    );
};

const ContextMenuDirectory = ({ target }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);

    const { createNewFile } = useFileCreate();
    const { createDirectory } = useDirectoryCreate();
    const { startRenaming } = useFileRename();
    const { remove } = useFileRemove();

    const actions = [
        { label: "New note", icon: FilePlus, action: () => createNewFile(target.path) },
        { label: "New directory", icon: FolderPlus, action: () => createDirectory(target.path) },
        { separator: true },
        { label: "Rename", icon: PenLine, action: () => startRenaming(target.path, AppSections.FILE_EXPLORER_FILES) },
        { label: "Delete", icon: Trash2, action: () => remove(target.path), className: "text-red-500 hover:bg-red-50" }
    ]

    const handleOnClick = (action) => {
        action();
        setContextMenuVisible(false);
    }

    return actions.map((item, index) =>
        item.separator ? (
            <ContextMenuSeparator key={`separator-${index}`} />
        ) : (
            <ContextMenuItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleOnClick(item.action)} className={item.className} />
        )
    );
}

const ContextMenuFileExplorer = () => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom)
    const { createNewFile } = useFileCreate()
    const { createDirectory } = useDirectoryCreate()

    const actions = [
        { label: "New note", icon: FilePlus, action: () => createNewFile() },
        { label: "New directory", icon: FolderPlus, action: () => createDirectory() },
    ]

    const handleOnClick = (action) => {
        action();
        setContextMenuVisible(false)
    }

    return actions.map(({ label, icon, action }) => (
        <ContextMenuItem key={label} icon={icon} label={label} onClick={() => handleOnClick(action)} />
    ))
}

const ContextMenuFileBookmarks = ({ target }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    const { open } = useFileOpen();
    const { remove } = useFileRemove();
    const { startRenaming } = useFileRename();
    const { removeBookmark } = useManageFileBookmark();

    const actions = [
        { label: "Open", icon: FileText, action: () => open(target.path) },
        { label: "Rename", icon: PenLine, action: () => startRenaming(target.path, AppSections.FILE_EXPLORER_BOOKMARKS) },
        { separator: true },
        { label: "Clear bookmark", icon: BookmarkX, action: () => removeBookmark(target) },
        { separator: true },
        { label: "Delete", icon: Trash2, action: () => remove(target.path), className: "text-red-500 hover:bg-red-50" }
    ];

    const handleOnClick = (action) => {
        action();
        setContextMenuVisible(false);
    }

    return actions.map((item, index) =>
        item.separator ? (
            <ContextMenuSeparator key={`separator-${index}`} />
        ) : (
            <ContextMenuItem key={item.label} icon={item.icon} label={item.label} onClick={() => handleOnClick(item.action)} className={item.className} />
        )
    );
};

const contextMenuComponents = {
    [ContextMenuTypes.FILE]: ContextMenuFile,
    [ContextMenuTypes.DIRECTORY]: ContextMenuDirectory,
    [ContextMenuTypes.FILEEXPLORER]: ContextMenuFileExplorer,
    [ContextMenuTypes.FILEBOOKMARKS]: ContextMenuFileBookmarks
}



export const ContextMenu = ({ id }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    const [contextMenuType, setContextMenuType] = useAtom(contextMenuTypeAtom);
    const [contextMenuPosition, setContextMenuPosition] = useAtom(contextMenuPositionAtom);
    const [contextMenuTarget] = useAtom(contextMenuTargetAtom);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setContextMenuVisible(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [setContextMenuVisible]);

    if (!contextMenuVisible) return null;

    const MenuComponent = contextMenuComponents[contextMenuType];

    return (
        <div
            id={id}
            ref={menuRef}
            className="absolute bg-white border border-gray-300 shadow-md rounded-md w-40 py-2 text-sm z-50"
            style={{ top: contextMenuPosition[1], left: contextMenuPosition[0] }}
        >
            <MenuComponent target={contextMenuTarget} />
        </div>
    );
};
