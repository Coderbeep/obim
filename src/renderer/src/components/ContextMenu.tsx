import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import {
  useManageFileBookmark,
  useDirectoryCreate,
  useFileCreate,
  useFileOpen,
  useFileRemove,
  useFileRename,
} from "@hooks/file-actions-hooks/useFileActions";
import {
  contextMenuPositionAtom,
  contextMenuTargetAtom,
  contextMenuTypeAtom,
  contextMenuVisibleAtom,
} from "@store/ContextMenuStore";

import { ContextMenuTypes } from "@shared/constants";
import {
  FilePlus,
  FolderPlus,
  PenLine,
  Trash2,
  FileText,
  Bookmark,
  BookmarkX,
} from "lucide-react";
import { FileItem } from "@shared/models";
import { bookmarkRepository } from "@renderer/services/BookmarkRepository";

type Target = {
  target: FileItem;
};

const ContextMenuSeparator = () => (
  <div className="border-t border-gray-200 my-1 mx-2" />
);

const ContextMenuItem = ({ icon: Icon, label, onClick, className = "" }) => (
  <div
    className={`flex items-center gap-2 px-2 mx-2 rounded-md py-[0.5px] cursor-pointer hover:bg-gray-100 ${className}`}
    onClick={onClick}
  >
    <Icon className={`w-[16px] h-[16px] text-gray-600 ${className}`} />
    <span className={`text-gray-800 text-[13px] ${className || ""}`}>
      {" "}
      {label}{" "}
    </span>
  </div>
);

const ContextMenuFile = ({ target }: Target) => {
  const [, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
  const { open } = useFileOpen();
  const { remove } = useFileRemove();
  const { startRenaming } = useFileRename();
  const { addBookmark, removeBookmark } = useManageFileBookmark();

  const [isBookmarked, setIsBookmarked] = useState(false);

  useEffect(() => {
    let active = true;
    bookmarkRepository.exists(target.path).then((exists) => {
      if (active) setIsBookmarked(exists);
    });

    return () => {
      active = false;
    };
  }, [target.path]);

  const actions = [
    { label: "Open", icon: FileText, action: () => open(target) },
    {
      label: "Rename",
      icon: PenLine,
      action: () => startRenaming(target.path),
    },
    { separator: true },
    !isBookmarked
      ? {
          label: "Add bookmark",
          icon: Bookmark,
          action: () => addBookmark(target),
        }
      : {
          label: "Clear bookmark",
          icon: BookmarkX,
          action: () => removeBookmark(target),
        },
    { separator: true },
    {
      label: "Delete",
      icon: Trash2,
      action: () => remove(target),
      className: "text-red-500 hover:bg-red-50",
    },
  ].filter(Boolean);

  const handleOnClick = (action) => {
    action();
    setContextMenuVisible(false);
  };

  return actions.map((item, index) =>
    item.separator ? (
      <ContextMenuSeparator key={`separator-${index}`} />
    ) : (
      <ContextMenuItem
        key={item.label}
        icon={item.icon}
        label={item.label}
        onClick={() => handleOnClick(item.action)}
        className={item.className}
      />
    ),
  );
};
const ContextMenuDirectory = ({ target }: Target) => {
  const [, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);

  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();
  const { startRenaming } = useFileRename();
  const { remove } = useFileRemove();

  const actions = [
    {
      label: "New note",
      icon: FilePlus,
      action: () => createNewFile(target.path),
    },
    {
      label: "New directory",
      icon: FolderPlus,
      action: () => createDirectory(target.path),
    },
    { separator: true },
    {
      label: "Rename",
      icon: PenLine,
      action: () => startRenaming(target.path),
    },
    {
      label: "Delete",
      icon: Trash2,
      action: () => remove(target),
      className: "text-red-500 hover:bg-red-50",
    },
  ];

  const handleOnClick = (action) => {
    action();
    setContextMenuVisible(false);
  };

  return actions.map((item, index) =>
    item.separator ? (
      <ContextMenuSeparator key={`separator-${index}`} />
    ) : (
      <ContextMenuItem
        key={item.label}
        icon={item.icon}
        label={item.label}
        onClick={() => handleOnClick(item.action)}
        className={item.className}
      />
    ),
  );
};

const ContextMenuFileExplorer = () => {
  const [, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();

  const actions = [
    { label: "New note", icon: FilePlus, action: () => createNewFile() },
    {
      label: "New directory",
      icon: FolderPlus,
      action: () => createDirectory(),
    },
  ];

  const handleOnClick = (action) => {
    action();
    setContextMenuVisible(false);
  };

  return actions.map(({ label, icon, action }) => (
    <ContextMenuItem
      key={label}
      icon={icon}
      label={label}
      onClick={() => handleOnClick(action)}
    />
  ));
};

const ContextMenuFileBookmarks = ({ target }: Target) => {
  const [, setContextMenuVisible] = useAtom(contextMenuVisibleAtom);
  const { open } = useFileOpen();
  const { remove } = useFileRemove();
  const { startRenaming } = useFileRename();
  const { removeBookmark } = useManageFileBookmark();

  const actions = [
    { label: "Open", icon: FileText, action: () => open(target) },
    {
      label: "Rename",
      icon: PenLine,
      action: () => startRenaming(target.path),
    },
    { separator: true },
    {
      label: "Clear bookmark",
      icon: BookmarkX,
      action: () => removeBookmark(target),
    },
    { separator: true },
    {
      label: "Delete",
      icon: Trash2,
      action: () => remove(target),
      className: "text-red-500 hover:bg-red-50",
    },
  ];

  const handleOnClick = (action) => {
    action();
    setContextMenuVisible(false);
  };

  return actions.map((item, index) =>
    item.separator ? (
      <ContextMenuSeparator key={`separator-${index}`} />
    ) : (
      <ContextMenuItem
        key={item.label}
        icon={item.icon}
        label={item.label}
        onClick={() => handleOnClick(item.action)}
        className={item.className}
      />
    ),
  );
};

const contextMenuComponents = {
  [ContextMenuTypes.FILE]: ContextMenuFile,
  [ContextMenuTypes.DIRECTORY]: ContextMenuDirectory,
  [ContextMenuTypes.FILEEXPLORER]: ContextMenuFileExplorer,
  [ContextMenuTypes.FILEBOOKMARKS]: ContextMenuFileBookmarks,
};

export const ContextMenu = ({ id }) => {
  const [contextMenuVisible, setContextMenuVisible] = useAtom(
    contextMenuVisibleAtom,
  );
  const [contextMenuType] = useAtom(contextMenuTypeAtom);
  const [contextMenuPosition] = useAtom(contextMenuPositionAtom);
  const [contextMenuTarget] = useAtom(contextMenuTargetAtom);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menuRef.current) {
      menuRef.current.focus();
    }

    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setContextMenuVisible(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [setContextMenuVisible, contextMenuVisible]);

  if (!contextMenuVisible) return null;

  const MenuComponent = contextMenuComponents[contextMenuType];

  return (
    <div
      id={id}
      ref={menuRef}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Escape" && setContextMenuVisible(false)}
      className="absolute bg-white border border-gray-300 shadow-md rounded-md w-40 py-2 text-sm z-50 focus:outline-none"
      style={{ top: contextMenuPosition[1], left: contextMenuPosition[0] }}
    >
      <MenuComponent target={contextMenuTarget!} />
    </div>
  );
};
