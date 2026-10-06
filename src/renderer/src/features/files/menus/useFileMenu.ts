import {
  IconBookmark,
  IconClockArrow,
  IconCopy,
  IconFileExport,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconPencil,
  IconTrash,
} from "@pierre/icons";
import { useAtomValue, useSetAtom } from "jotai";
import type { MouseEvent } from "react";

import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { openContextMenuAtom } from "@renderer/store/contextMenuStore";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import {
  ACTION_LABELS,
  addBookmarksLabel,
  moveItemsToFolderLabel,
  moveItemsToTrashLabel,
  removeBookmarksLabel,
} from "@renderer/shared/actionLabels";

import { useFileOpenInNewPane } from "../useFileOpenInNewPane";
import { useFileCopy, useFileOpen, useFileRemove, useFileRename, useManageFileBookmark } from "../fileActions";
import { getPathWithoutFilename } from "@shared/pathUtils";
import { revealInSystemFileManager } from "../workspaceFileService";
import { IconBookmarkX } from "../icons/IconBookmarkX";
import { IconOpenInNewPane } from "../icons/IconOpenInNewPane";
import { useFileClipboard } from "../useFileClipboard";
import { createCopyMenuEntry } from "./copyMenuEntry";
import { type FileMenuPlacement, type FileMenuTarget, useFileMenuTargets } from "./fileMenuTargets";
import { useFileHistoryOpen } from "@renderer/features/git/useFileHistoryOpen";
import { useActionRunner } from "@renderer/features/actions/useActionRunner";
import { isMarkdownFile } from "@shared/mime-types";
import { useNotePdfExport } from "../useNotePdfExport";

export const useFileMenu = () => {
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const bookmarks = useAtomValue(bookmarksAtom);
  const resolveTargets = useFileMenuTargets();
  const { open } = useFileOpen();
  const openInNewPane = useFileOpenInNewPane();
  const { copyManyToDirectory } = useFileCopy();
  const { removeMany } = useFileRemove();
  const { startRenaming } = useFileRename();
  const { addBookmark, addBookmarks, removeBookmark, removeBookmarks } = useManageFileBookmark();
  const { copyAbsolutePaths, copyItems, copyRelativePaths } = useFileClipboard();
  const { openFileHistory } = useFileHistoryOpen();
  const { openMoveToFolder } = useActionRunner();
  const { openNotePdfExport } = useNotePdfExport();

  const openFileMenuAt = (target: FileMenuTarget, placement: FileMenuPlacement, targetOverride?: FileMenuTarget[]) => {
    const targets = targetOverride ?? resolveTargets(target);
    const multi = targets.length > 1;
    const bookmarkable = targets.filter((item) => !item.isDirectory);
    const bookmarked = bookmarks.some((bookmark) => bookmark.path === target.path);
    const entries: ContextMenuEntry[] = [];

    if (!multi) {
      entries.push(
        { kind: "action", id: "open", label: "Open", icon: IconFileText, onSelect: () => open(target) },
        {
          kind: "action",
          id: "open-new-pane",
          label: ACTION_LABELS.openInNewPane,
          icon: IconOpenInNewPane,
          onSelect: () => openInNewPane(target),
        },
        {
          kind: "action",
          id: "version-history",
          label: ACTION_LABELS.fileHistory,
          icon: IconClockArrow,
          onSelect: () => openFileHistory(target),
        },
        ...(isMarkdownFile(target.mimeType, target.path)
          ? ([
              {
                kind: "action",
                id: "export-note-pdf",
                label: ACTION_LABELS.exportNotePdf,
                icon: IconFileExport,
                onSelect: () => openNotePdfExport(target),
              },
            ] satisfies ContextMenuEntry[])
          : []),
        { kind: "separator" },
      );
    }

    entries.push(createCopyMenuEntry(targets, copyItems, copyAbsolutePaths, copyRelativePaths));
    if (!multi) {
      entries.push({
        kind: "action",
        id: "make-copy",
        label: ACTION_LABELS.duplicate,
        icon: IconCopy,
        onSelect: () => void copyManyToDirectory([target], getPathWithoutFilename(target.path)),
      });
    }
    entries.push({
      kind: "action",
      id: "move-to-folder",
      label: moveItemsToFolderLabel(targets.length),
      icon: IconFolder,
      onSelect: () => openMoveToFolder(targets),
    });
    entries.push({ kind: "separator" });

    if (multi && bookmarkable.length > 0) {
      entries.push(
        {
          kind: "action",
          id: "add-bookmarks",
          label: addBookmarksLabel(bookmarkable.length),
          icon: IconBookmark,
          onSelect: () => addBookmarks(bookmarkable),
        },
        {
          kind: "action",
          id: "remove-bookmarks",
          label: removeBookmarksLabel(bookmarkable.length),
          icon: IconBookmarkX,
          onSelect: () => removeBookmarks(bookmarkable),
        },
        { kind: "separator" },
      );
    } else if (!multi) {
      entries.push(
        bookmarked
          ? {
              kind: "action",
              id: "remove-bookmark",
              label: ACTION_LABELS.removeBookmark,
              icon: IconBookmarkX,
              onSelect: () => removeBookmark(target),
            }
          : {
              kind: "action",
              id: "add-bookmark",
              label: ACTION_LABELS.addBookmark,
              icon: IconBookmark,
              onSelect: () => addBookmark(target),
            },
      );
      entries.push({ kind: "separator" });
    }

    if (!multi) {
      entries.push(
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
      );
    }
    entries.push({
      kind: "action",
      id: "trash",
      label: moveItemsToTrashLabel(targets.length),
      icon: IconTrash,
      danger: true,
      onSelect: () => removeMany(targets),
    });

    openContextMenu({
      key: `file:${target.path}`,
      anchor: placement.anchor,
      position: { x: placement.x, y: placement.y },
      entries,
    });
  };

  const openFileMenu = (event: MouseEvent<HTMLElement>, target: FileMenuTarget) => {
    event.preventDefault();
    openFileMenuAt(target, { anchor: event.currentTarget, x: event.clientX, y: event.clientY }, [target]);
  };

  return { openFileMenu, openFileMenuAt };
};
