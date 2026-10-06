import { useSetAtom, useStore } from "jotai";
import { useCallback } from "react";

import { Notifications } from "@renderer/features/notifications/notifications";
import { addNotificationAtom, type Notification } from "@renderer/store/NotificationsStore";
import { copiedWorkspaceFilePathsAtom, fileTreeAtom } from "@renderer/store/fileExplorerStore";
import { getWorkspacePath } from "@renderer/config";
import type { FileItem } from "@shared/file-item";
import { imageExtensionFromMimeType } from "@shared/mime-types";
import { getRelativePathFromPath } from "@shared/pathUtils";

import { useExternalFileImport, useFileCopy } from "./fileActions";
import { filterTopLevelItems, findItemNode } from "./fileTreeUtils";

export const FILE_EXPLORER_CLIPBOARD_MIME = "application/x-obim-file-paths";

const uniqueItems = (items: FileItem[]) => Array.from(new Map(items.map((item) => [item.path, item])).values());
const serializePaths = (paths: string[]) => paths.join("\n");

const parseClipboardPaths = (value: string) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((path) => typeof path === "string") ? parsed : null;
  } catch {
    return null;
  }
};

const getClipboardFiles = (data: DataTransfer) => {
  const itemFiles = Array.from(data.items ?? []).reduce<File[]>((files, item) => {
    if (item.kind === "file") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    return files;
  }, []);
  return itemFiles.length ? itemFiles : Array.from(data.files ?? []);
};

const hasClipboardImages = (items: ClipboardItem[]) =>
  items.some((item) => item.types.some((type) => imageExtensionFromMimeType(type) !== null));

export const useFileClipboard = () => {
  const store = useStore();
  const setCopiedPaths = useSetAtom(copiedWorkspaceFilePathsAtom);
  const addNotification = useSetAtom(addNotificationAtom);
  const { copyManyToDirectory } = useFileCopy();
  const { importExternalFiles } = useExternalFileImport();

  const notify = useCallback(
    (notification: Omit<Notification, "id" | "timestamp">) =>
      addNotification({
        ...notification,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }),
    [addNotification],
  );

  const writeText = useCallback(
    async (text: string) => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        notify(Notifications.CLIPBOARD_WRITE_FAILED);
        return false;
      }
    },
    [notify],
  );

  const copyItems = useCallback(
    (items: FileItem[], data?: DataTransfer | null) => {
      const paths = filterTopLevelItems(items).map((item) => item.path);
      if (!paths.length) return false;

      const plainText = serializePaths(paths);
      setCopiedPaths(paths);
      if (data) {
        data.setData(FILE_EXPLORER_CLIPBOARD_MIME, JSON.stringify(paths));
        data.setData("text/plain", plainText);
      } else {
        void writeText(plainText);
      }
      return true;
    },
    [setCopiedPaths, writeText],
  );

  const copyAbsolutePaths = useCallback(
    async (items: FileItem[]) => {
      const paths = uniqueItems(items).map((item) => item.path);
      if (!paths.length) return false;
      const copied = await writeText(serializePaths(paths));
      if (copied) setCopiedPaths(null);
      return copied;
    },
    [setCopiedPaths, writeText],
  );

  const copyRelativePaths = useCallback(
    async (items: FileItem[]) => {
      const paths = uniqueItems(items).map((item) => getRelativePathFromPath(item.path, getWorkspacePath()));
      if (!paths.length) return false;
      const copied = await writeText(serializePaths(paths));
      if (copied) setCopiedPaths(null);
      return copied;
    },
    [setCopiedPaths, writeText],
  );

  const pastePaths = useCallback(
    (paths: string[], destinationDirectoryPath: string) => {
      const currentTree = store.get(fileTreeAtom);
      const files = paths
        .map((path) => findItemNode(currentTree, path))
        .filter((file): file is FileItem => Boolean(file));

      if (!files.length) {
        setCopiedPaths(null);
        notify(Notifications.FILE_COPY_FAILED("The copied items no longer exist."));
        return false;
      }

      void copyManyToDirectory(filterTopLevelItems(files), destinationDirectoryPath);
      return true;
    },
    [copyManyToDirectory, notify, setCopiedPaths, store],
  );

  const readClipboardSnapshot = useCallback(async (): Promise<{
    items: ClipboardItem[];
    plainText: string;
  } | null> => {
    try {
      if (!navigator.clipboard?.read) return null;
      const items = await navigator.clipboard.read();
      const textItem = items.find((item) => item.types.includes("text/plain"));
      let plainText = "";

      if (textItem) {
        try {
          plainText = await (await textItem.getType("text/plain")).text();
        } catch {
          // Other supported clipboard formats can still be pasted.
        }
      }

      return { items, plainText };
    } catch {
      return null;
    }
  }, []);

  const reconcilePasteAvailability = useCallback(async () => {
    const snapshot = await readClipboardSnapshot();
    if (!snapshot) return false;

    const copiedPaths = store.get(copiedWorkspaceFilePathsAtom);
    const matchesInternalCopy = Boolean(copiedPaths && snapshot.plainText === serializePaths(copiedPaths));
    if (copiedPaths && !matchesInternalCopy) setCopiedPaths(null);
    if (hasClipboardImages(snapshot.items)) return true;
    if (!copiedPaths || !matchesInternalCopy) return false;

    const currentTree = store.get(fileTreeAtom);
    const hasCurrentItems = copiedPaths.some((path) => findItemNode(currentTree, path));
    if (!hasCurrentItems) setCopiedPaths(null);
    return hasCurrentItems;
  }, [readClipboardSnapshot, setCopiedPaths, store]);

  const pasteSystemClipboard = useCallback(
    async (destinationDirectoryPath: string) => {
      const snapshot = await readClipboardSnapshot();
      if (!snapshot) {
        notify(Notifications.CLIPBOARD_READ_FAILED);
        return false;
      }

      if (hasClipboardImages(snapshot.items)) {
        try {
          const clipboardFiles = await Promise.all(
            snapshot.items.map(async (item) => {
              const type = item.types.find((candidate) => imageExtensionFromMimeType(candidate) !== null);
              if (!type) return null;
              const extension = imageExtensionFromMimeType(type);
              if (!extension) return null;
              const blob = await item.getType(type);
              return new File([blob], `clipboard.${extension}`, { type });
            }),
          );
          const files = clipboardFiles.filter((file): file is File => file !== null);
          setCopiedPaths(null);
          void importExternalFiles(files, destinationDirectoryPath);
          return true;
        } catch {
          notify(Notifications.CLIPBOARD_READ_FAILED);
          return false;
        }
      }

      const copiedPaths = store.get(copiedWorkspaceFilePathsAtom);
      if (copiedPaths && snapshot.plainText === serializePaths(copiedPaths)) {
        return pastePaths(copiedPaths, destinationDirectoryPath);
      }

      if (copiedPaths) setCopiedPaths(null);
      notify(Notifications.NOTHING_TO_PASTE);
      return false;
    },
    [importExternalFiles, notify, pastePaths, readClipboardSnapshot, setCopiedPaths, store],
  );

  const pasteClipboardData = useCallback(
    (data: DataTransfer, destinationDirectoryPath: string) => {
      const files = getClipboardFiles(data);
      if (files.length) {
        setCopiedPaths(null);
        void importExternalFiles(files, destinationDirectoryPath);
        return true;
      }

      const markedPaths = parseClipboardPaths(data.getData(FILE_EXPLORER_CLIPBOARD_MIME));
      if (markedPaths?.length) return pastePaths(markedPaths, destinationDirectoryPath);

      const copiedPaths = store.get(copiedWorkspaceFilePathsAtom);
      const plainText = data.getData("text/plain");
      return copiedPaths && plainText === serializePaths(copiedPaths)
        ? pastePaths(copiedPaths, destinationDirectoryPath)
        : false;
    },
    [importExternalFiles, pastePaths, setCopiedPaths, store],
  );

  return {
    reconcilePasteAvailability,
    copyAbsolutePaths,
    copyItems,
    copyRelativePaths,
    pasteClipboardData,
    pasteSystemClipboard,
  };
};
