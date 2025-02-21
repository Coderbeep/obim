import { useFileExplorer } from "@renderer/hooks/useFileExplorer";
import { contextMenuPositionAtom, contextMenuTargetAtom, contextMenuTypeAtom, contextMenuVisibleAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { GoPencil, GoTrash } from "react-icons/go";
import { PiFilePlusLight } from "react-icons/pi";

export enum ContextMenuTypes {
    FILE,
    DIRECTORY
}

const ContextMenuItem = ({ icon: Icon, label, onClick, className }) => (
    <div
        className={`flex items-center gap-2 px-2 mx-2 rounded-md py-[2px] cursor-pointer hover:bg-gray-100 ${className}`}
        onClick={onClick}
    >
        <Icon className={`w-[14px] h-[14px] text-gray-600 ${className}`} />
        <span className={`text-gray-800 ${className}`}> {label} </span>
    </div>
);

const ContextMenuDirectory = ({ target }) => {
    const actions = [
        { label: "New note", icon: PiFilePlusLight, action: () => console.log("New File") },
        { label: "New directory", icon: PiFilePlusLight, action: () => console.log("New Folder") },
        { label: "Rename", icon: GoPencil, action: () => console.log("Rename") },
        { label: "Delete", icon: GoTrash, action: () => console.log("Delete"), className: "text-red-500 hover:bg-red-50" }
    ]

    return actions.map(({ label, icon, action, className = "" }) => (
        <ContextMenuItem key={label} icon={icon} label={label} onClick={action} className={className}/>
    ));
}

const ContextMenuFile = ({ target }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    const { openFile } = useFileExplorer();

    const actions = [
        { label: "Open", icon: PiFilePlusLight, action: () => openFile(target.path) },
        { label: "Rename", icon: GoPencil, action: () => console.log("Rename") },
        { label: "Delete", icon: GoTrash, action: () => console.log("Delete"), className: "text-red-500 hover:bg-red-50" }
    ];

    const handleOnClick = (action) => {
        action();
        setContextMenuVisible(false);
    }

    return actions.map(({ label, icon, action, className = "" }) => (
        <ContextMenuItem key={label} icon={icon} label={label} onClick={() => handleOnClick(action)} className={className} />
    ));
};


const contextMenuComponents = {
    [ContextMenuTypes.FILE]: ContextMenuFile,
    [ContextMenuTypes.DIRECTORY]: ContextMenuDirectory
}

export const ContextMenu = ({ id, type }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    const [contextMenuType, setContextMenuType] = useAtom(contextMenuTypeAtom);
    const [contextMenuPosition, setContextMenuPosition] = useAtom(contextMenuPositionAtom);
    const [contextMenuTarget] = useAtom(contextMenuTargetAtom);
    const menuRef = useRef(null);

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
