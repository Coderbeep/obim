import { contextMenuPositionAtom, contextMenuVisibleAtom } from "@renderer/store/NotesStore";
import { useAtom } from "jotai";
import { GoPencil, GoTrash } from "react-icons/go";
import { PiFilePlusLight } from "react-icons/pi";

export const ContextMenuType = {
    FILE: "FILE",
    DIRECTORY: "DIRECTORY"
};

export const ContextMenuAction = {
    OPEN: () => console.log("Open"),
    RENAME: () => console.log("Rename"),
    DELETE: () => console.log("Delete")
};

const menuItems = {
    [ContextMenuType.FILE]: [
        { label: "Open", icon: PiFilePlusLight, action: ContextMenuAction.OPEN },
        { label: "Rename", icon: GoPencil, action: ContextMenuAction.RENAME },
        { label: "Delete", icon: GoTrash, action: ContextMenuAction.DELETE, className: "text-red-500 hover:bg-red-100" }
    ],
    [ContextMenuType.DIRECTORY]: [
        { label: "Open", icon: PiFilePlusLight, action: ContextMenuAction.OPEN },
        { label: "Rename", icon: GoPencil, action: ContextMenuAction.RENAME }
    ]
};

const ContextMenuItem = ({ children, icon: Icon, onClick, className = "" }) => {
    const [contextMenuVisible, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
    
    const handleOnClick = () => {
        onClick();
        setContextMenuVisible(false);
    }

    return (
        <div
            className={`flex items-center gap-2 px-2 mx-2 rounded-md py-[2px] cursor-pointer hover:bg-gray-100 ${className}`}
            onClick={handleOnClick}
        >
            <Icon className={`w-4 h-4 text-gray-600 ${className}`} />
            <span className={`text-gray-800 ${className}`}>{children}</span>
        </div>
    );
};

export const ContextMenu = ({ id, type }) => {
    const [ contextMenuVisible, setContextMenuVisible ] = useAtom(contextMenuVisibleAtom);
    const [ contextMenuPosition, setContextMenuPosition ] = useAtom(contextMenuPositionAtom);

    if (!contextMenuVisible) return null;

    return (
        <div
            id={id}
            className={`absolute bg-white border border-gray-300 shadow-md rounded-md border w-40 py-2 text-sm`}
            style={{ top: contextMenuPosition[1], left: contextMenuPosition[0] }}
        >
            {menuItems[type]?.map(({ label, icon, action, className }) => (
                <ContextMenuItem key={label} icon={icon} onClick={action} className={className}>
                    {label}
                </ContextMenuItem>
            ))}
        </div>
    );
};
