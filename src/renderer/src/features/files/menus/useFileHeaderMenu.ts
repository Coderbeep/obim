import {
  IconArrowUpRight,
  IconBookmark,
  IconClockArrow,
  IconFileExport,
  IconFolder,
  IconFolderOpen,
  IconPencil,
  IconTrash,
} from "@pierre/icons";
import { useAtomValue, useSetAtom } from "jotai";
import type { MouseEvent } from "react";

import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { openContextMenuAtom } from "@renderer/store/contextMenuStore";
import { NotificationLevel, addNotificationAtom } from "@renderer/store/NotificationsStore";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import { ACTION_LABELS } from "@renderer/shared/actionLabels";
import type { FileItem } from "@shared/file-item";

import { useFileRemove, useFileRename, useManageFileBookmark } from "../fileActions";
import { openInDefaultApp, revealInSystemFileManager } from "../workspaceFileService";
import { IconBookmarkX } from "../icons/IconBookmarkX";
import { useFileHistoryOpen } from "@renderer/features/git/useFileHistoryOpen";
import { useActionRunner } from "@renderer/features/actions/useActionRunner";
import { isMarkdownFile, isPdfFile } from "@shared/mime-types";
import { useNotePdfExport } from "../useNotePdfExport";

type TabLocation = { paneId: string; tabId: string };

export const useFileHeaderMenu = () => {
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  const bookmarks = useAtomValue(bookmarksAtom);
  const { startRenaming } = useFileRename();
  const { addBookmark, removeBookmark } = useManageFileBookmark();
  const { remove } = useFileRemove();
  const { openFileHistory } = useFileHistoryOpen();
  const { openMoveToFolder } = useActionRunner();
  const { openNotePdfExport } = useNotePdfExport();

  const runPdfFileAction = async (file: FileItem, title: string, action: typeof openInDefaultApp) => {
    const result = await action(file.path);
    if (result.success) return;
    addNotification({
      id: crypto.randomUUID(),
      level: NotificationLevel.ERROR,
      title,
      message: result.error,
      path: file.path,
      timestamp: Date.now(),
    });
  };

  const openFileHeaderMenu = (event: MouseEvent<HTMLElement>, file: FileItem, location?: TabLocation) => {
    event.preventDefault();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    const bookmarked = bookmarks.some((bookmark) => bookmark.path === file.path);
    const isPanePdf = Boolean(location && !file.isDirectory && isPdfFile(file.mimeType, file.path));
    const entries: ContextMenuEntry[] = [
      {
        kind: "action",
        id: "rename",
        label: ACTION_LABELS.rename,
        icon: IconPencil,
        onSelect: () => startRenaming(file.path, location ? "file-header" : "explorer"),
      },
      {
        kind: "action",
        id: "version-history",
        label: ACTION_LABELS.fileHistory,
        icon: IconClockArrow,
        onSelect: () => openFileHistory(file),
      },
      {
        kind: "action",
        id: "move-to-folder",
        label: ACTION_LABELS.moveToFolder,
        icon: IconFolder,
        onSelect: () => openMoveToFolder([file]),
      },
      ...(isMarkdownFile(file.mimeType, file.path)
        ? ([
            {
              kind: "action",
              id: "export-note-pdf",
              label: ACTION_LABELS.exportNotePdf,
              icon: IconFileExport,
              onSelect: () => openNotePdfExport(file),
            },
          ] satisfies ContextMenuEntry[])
        : []),
      { kind: "separator" },
      bookmarked
        ? {
            kind: "action",
            id: "remove-bookmark",
            label: ACTION_LABELS.removeBookmark,
            icon: IconBookmarkX,
            onSelect: () => removeBookmark(file),
          }
        : {
            kind: "action",
            id: "add-bookmark",
            label: ACTION_LABELS.addBookmark,
            icon: IconBookmark,
            onSelect: () => addBookmark(file),
          },
      { kind: "separator" },
      ...(isPanePdf
        ? ([
            {
              kind: "action",
              id: "open-default-app",
              label: "Open in default app",
              icon: IconArrowUpRight,
              onSelect: () => void runPdfFileAction(file, "Could not open PDF", openInDefaultApp),
            },
          ] satisfies ContextMenuEntry[])
        : []),
      {
        kind: "action",
        id: "reveal",
        label: ACTION_LABELS.showInFileManager,
        icon: IconFolderOpen,
        onSelect: () =>
          isPanePdf
            ? void runPdfFileAction(file, "Could not show PDF", revealInSystemFileManager)
            : revealInSystemFileManager(file.path),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "trash",
        label: ACTION_LABELS.moveToTrash,
        icon: IconTrash,
        danger: true,
        onSelect: () => remove(file),
      },
    ];

    openContextMenu({
      key: `file-header:${file.path}:${location?.paneId ?? "hover"}:${location?.tabId ?? "window"}`,
      anchor: event.currentTarget,
      position: { x: anchorRect.right, y: anchorRect.bottom, alignX: "right" },
      toggleOnRepeat: true,
      entries,
    });
  };

  return { openFileHeaderMenu };
};
