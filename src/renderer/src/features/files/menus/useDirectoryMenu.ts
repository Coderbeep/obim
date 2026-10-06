import {
  IconBookmark,
  IconFilePlus,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconPencil,
  IconTrash,
} from "@pierre/icons";
import { useSetAtom, useStore } from "jotai";
import type { MouseEvent } from "react";

import { contextMenuRequestAtom, openContextMenuAtom } from "@renderer/store/contextMenuStore";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import {
  ACTION_LABELS,
  addBookmarksLabel,
  moveItemsToFolderLabel,
  moveItemsToTrashLabel,
  removeBookmarksLabel,
} from "@renderer/shared/actionLabels";
import { getWorkspacePath } from "@renderer/config";

import { useDirectoryCreate, useFileCreate, useFileRemove, useFileRename, useManageFileBookmark } from "../fileActions";
import { revealInSystemFileManager } from "../workspaceFileService";
import { IconBookmarkX } from "../icons/IconBookmarkX";
import { useFileClipboard } from "../useFileClipboard";
import { createCopyMenuEntry } from "./copyMenuEntry";
import { type FileMenuPlacement, type FileMenuTarget, useFileMenuTargets } from "./fileMenuTargets";
import { useActionRunner } from "@renderer/features/actions/useActionRunner";

export const useDirectoryMenu = () => {
  const store = useStore();
  const openContextMenu = useSetAtom(openContextMenuAtom);
  const resolveTargets = useFileMenuTargets();
  const { createNewFile } = useFileCreate();
  const { createDirectory } = useDirectoryCreate();
  const { startRenaming } = useFileRename();
  const { removeMany } = useFileRemove();
  const { addBookmarks, removeBookmarks } = useManageFileBookmark();
  const { reconcilePasteAvailability, copyAbsolutePaths, copyItems, copyRelativePaths, pasteSystemClipboard } =
    useFileClipboard();
  const { openMoveToFolder } = useActionRunner();

  const refreshPasteAvailability = (key: string) => {
    void reconcilePasteAvailability().then((canPaste) => {
      const current = store.get(contextMenuRequestAtom);
      if (current?.key !== key) return;

      store.set(contextMenuRequestAtom, {
        ...current,
        entries: current.entries.map((entry) =>
          entry.kind === "action" && entry.id === "paste" ? { ...entry, disabled: !canPaste } : entry,
        ),
      });
    });
  };

  const openDirectoryMenuForTargets = (
    target: FileMenuTarget,
    targets: FileMenuTarget[],
    placement: FileMenuPlacement,
    includePaste: boolean,
    includeRenameAndTrash = true,
  ) => {
    const multi = targets.length > 1;
    const bookmarkable = targets.filter((item) => !item.isDirectory);
    const entries: ContextMenuEntry[] = [];

    if (!multi) {
      entries.push(
        {
          kind: "action",
          id: "new-note",
          label: ACTION_LABELS.newNote,
          icon: IconFilePlus,
          onSelect: () => createNewFile(target.path),
        },
        {
          kind: "action",
          id: "new-directory",
          label: ACTION_LABELS.newFolder,
          icon: IconFolderPlus,
          onSelect: () => createDirectory(target.path),
        },
        { kind: "separator" },
      );
      if (includePaste) {
        entries.push(
          {
            kind: "action",
            id: "paste",
            label: "Paste",
            icon: IconFiles,
            disabled: true,
            onSelect: () => pasteSystemClipboard(target.path),
          },
          { kind: "separator" },
        );
      }
    }

    entries.push(createCopyMenuEntry(targets, copyItems, copyAbsolutePaths, copyRelativePaths));
    if (includeRenameAndTrash) {
      entries.push({
        kind: "action",
        id: "move-to-folder",
        label: moveItemsToFolderLabel(targets.length),
        icon: IconFolder,
        onSelect: () => openMoveToFolder(targets),
      });
    }
    entries.push({ kind: "separator" });

    if (!multi) {
      entries.push({
        kind: "action",
        id: "reveal",
        label: ACTION_LABELS.showInFileManager,
        icon: IconFolderOpen,
        onSelect: () => revealInSystemFileManager(target.path),
      });
      if (includeRenameAndTrash) {
        entries.push(
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
    } else if (bookmarkable.length > 0) {
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
    }

    if (includeRenameAndTrash) {
      entries.push({
        kind: "action",
        id: "trash",
        label: moveItemsToTrashLabel(targets.length),
        icon: IconTrash,
        danger: true,
        onSelect: () => removeMany(targets),
      });
    }

    const key = `directory:${target.path}`;
    openContextMenu({
      key,
      anchor: placement.anchor,
      position: { x: placement.x, y: placement.y },
      entries,
    });
    if (!multi && includePaste) refreshPasteAvailability(key);
  };

  const openDirectoryMenuAt = (target: FileMenuTarget, placement: FileMenuPlacement) =>
    openDirectoryMenuForTargets(target, resolveTargets(target), placement, true);

  const openRootMenuAt = (placement: FileMenuPlacement) => {
    const rootPath = getWorkspacePath();
    const entries: ContextMenuEntry[] = [
      {
        kind: "action",
        id: "new-note",
        label: ACTION_LABELS.newNote,
        icon: IconFilePlus,
        onSelect: () => createNewFile(rootPath),
      },
      {
        kind: "action",
        id: "new-directory",
        label: ACTION_LABELS.newFolder,
        icon: IconFolderPlus,
        onSelect: () => createDirectory(rootPath),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "paste",
        label: "Paste",
        icon: IconFiles,
        disabled: true,
        onSelect: () => pasteSystemClipboard(rootPath),
      },
      { kind: "separator" },
      {
        kind: "action",
        id: "reveal",
        label: ACTION_LABELS.showInFileManager,
        icon: IconFolderOpen,
        onSelect: () => revealInSystemFileManager(rootPath),
      },
    ];

    openContextMenu({
      key: "directory:root",
      anchor: placement.anchor,
      position: { x: placement.x, y: placement.y },
      entries,
    });
    refreshPasteAvailability("directory:root");
  };

  const openDirectoryMenu = (event: MouseEvent<HTMLElement>, target: FileMenuTarget) => {
    event.preventDefault();
    openDirectoryMenuAt(target, { anchor: event.currentTarget, x: event.clientX, y: event.clientY });
  };

  const openBreadcrumbDirectoryMenu = (event: MouseEvent<HTMLElement>, target: FileMenuTarget) => {
    event.preventDefault();
    openDirectoryMenuForTargets(
      target,
      [target],
      {
        anchor: event.currentTarget,
        x: event.clientX,
        y: event.clientY,
      },
      false,
      false,
    );
  };

  return { openBreadcrumbDirectoryMenu, openDirectoryMenu, openDirectoryMenuAt, openRootMenuAt };
};
