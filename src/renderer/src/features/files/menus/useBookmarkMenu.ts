import { IconFileText, IconFolder, IconFolderOpen, IconPencil, IconTrash } from "@pierre/icons";
import { useSetAtom } from "jotai";
import type { MouseEvent } from "react";

import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { openContextMenuAtom } from "@renderer/store/contextMenuStore";
import { ACTION_LABELS } from "@renderer/shared/actionLabels";

import { useFileOpenInNewPane } from "../useFileOpenInNewPane";
import { useFileOpen, useFileRemove, useFileRename, useManageFileBookmark } from "../fileActions";
import { revealInSystemFileManager } from "../workspaceFileService";
import { IconBookmarkX } from "../icons/IconBookmarkX";
import { IconOpenInNewPane } from "../icons/IconOpenInNewPane";
import { useFileClipboard } from "../useFileClipboard";
import { createCopyMenuEntry } from "./copyMenuEntry";
import type { FileMenuTarget } from "./fileMenuTargets";
import { useActionRunner } from "@renderer/features/actions/useActionRunner";

export const useBookmarkMenu = () => {
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const { open } = useFileOpen();
  const openInNewPane = useFileOpenInNewPane();
  const { remove } = useFileRemove();
  const { startRenaming } = useFileRename();
  const { removeBookmark } = useManageFileBookmark();
  const { copyAbsolutePaths, copyItems, copyRelativePaths } = useFileClipboard();
  const { openMoveToFolder } = useActionRunner();

  const openBookmarkMenu = (event: MouseEvent<HTMLElement>, target: FileMenuTarget) => {
    event.preventDefault();
    const entries: ContextMenuEntry[] = [
      { kind: "action", id: "open", label: "Open", icon: IconFileText, onSelect: () => open(target) },
      {
        kind: "action",
        id: "open-new-pane",
        label: ACTION_LABELS.openInNewPane,
        icon: IconOpenInNewPane,
        onSelect: () => openInNewPane(target),
      },
      { kind: "separator" },
      createCopyMenuEntry([target], copyItems, copyAbsolutePaths, copyRelativePaths),
      {
        kind: "action",
        id: "move-to-folder",
        label: ACTION_LABELS.moveToFolder,
        icon: IconFolder,
        onSelect: () => openMoveToFolder([target]),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "remove-bookmark",
        label: ACTION_LABELS.removeBookmark,
        icon: IconBookmarkX,
        onSelect: () => removeBookmark(target),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "reveal",
        label: ACTION_LABELS.showInFileManager,
        icon: IconFolderOpen,
        onSelect: () => revealInSystemFileManager(target.path),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "rename",
        label: ACTION_LABELS.rename,
        icon: IconPencil,
        onSelect: () => startRenaming(target.path),
      },
      {
        kind: "action",
        id: "trash",
        label: ACTION_LABELS.moveToTrash,
        icon: IconTrash,
        danger: true,
        onSelect: () => remove(target),
      },
    ];

    openContextMenu({
      key: `bookmark:${target.path}`,
      anchor: event.currentTarget,
      position: { x: event.clientX, y: event.clientY },
      entries,
    });
  };

  return { openBookmarkMenu };
};
