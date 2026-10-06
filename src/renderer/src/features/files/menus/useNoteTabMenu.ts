import { IconBookmark, IconClockArrow, IconFileExport, IconFolder, IconFolderOpen, IconTrash } from "@pierre/icons";
import { useAtomValue } from "jotai";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { bookmarksAtom } from "@renderer/store/bookmarkStore";
import { ACTION_LABELS } from "@renderer/shared/actionLabels";
import type { FileItem } from "@shared/file-item";

import { useFileRemove, useManageFileBookmark } from "../fileActions";
import { revealInSystemFileManager } from "../workspaceFileService";
import { IconBookmarkX } from "../icons/IconBookmarkX";
import { useFileHistoryOpen } from "@renderer/features/git/useFileHistoryOpen";
import { useActionRunner } from "@renderer/features/actions/useActionRunner";
import { isMarkdownFile } from "@shared/mime-types";
import { useNotePdfExport } from "../useNotePdfExport";

export const useNoteTabMenu = () => {
  const bookmarks = useAtomValue(bookmarksAtom);
  const { remove } = useFileRemove();
  const { addBookmark, removeBookmark } = useManageFileBookmark();
  const { openFileHistory } = useFileHistoryOpen();
  const { openMoveToFolder } = useActionRunner();
  const { openNotePdfExport } = useNotePdfExport();

  const getNoteTabMenuEntries = (file: FileItem): ContextMenuEntry[] => {
    const bookmarked = bookmarks.some((bookmark) => bookmark.path === file.path);
    const entries: ContextMenuEntry[] = [
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
      {
        kind: "action",
        id: "reveal",
        label: ACTION_LABELS.showInFileManager,
        icon: IconFolderOpen,
        onSelect: () => revealInSystemFileManager(file.path),
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

    return entries;
  };

  return { getNoteTabMenuEntries };
};
