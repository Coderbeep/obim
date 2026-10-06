import { IconCode, IconCopy, IconFileExport, IconFolderOpen, IconImage, IconTrash } from "@pierre/icons";
import { useSetAtom, useStore } from "jotai";
import { useMemo, useState } from "react";
import { openContextMenuAtom } from "@renderer/store/contextMenuStore";
import { fileTreeAtom } from "@renderer/store/fileExplorerStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { isRemoteImageSource } from "@renderer/features/files/imageSource";
import { copyRenderedImage } from "@renderer/features/files/imageClipboard";
import { ImageViewer } from "@renderer/features/files/ImageViewer";
import {
  resolveLinkedWorkspaceItem,
  resolveWikiImageWorkspaceFile,
} from "@renderer/features/files/workspaceFileResolver";
import {
  exportWorkspaceFileCopy,
  openInDefaultApp,
  revealInSystemFileManager,
} from "@renderer/features/files/workspaceFileService";
import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import type { FileItem } from "@shared/file-item";
import type { ImageActions } from "./extensions/ImageExtension";

type ImageFile = Extract<FileItem, { isDirectory: false }>;

export function useEditorImages(filePath: string) {
  const store = useStore();
  const openMenu = useSetAtom(openContextMenuAtom);
  const notify = useSetAtom(addNotificationAtom);
  const [imageFile, setImageFile] = useState<ImageFile | null>(null);
  const imageActions = useMemo<ImageActions>(() => {
    const resolvedWikiSources = new Map<string, string | null>();
    let resolvedTree: FileItem[] | null = null;
    const getTree = () => {
      const tree = store.get(fileTreeAtom);
      if (tree !== resolvedTree) {
        resolvedTree = tree;
        resolvedWikiSources.clear();
      }
      return tree;
    };
    const resolve = (src: string) => {
      const file = resolveLinkedWorkspaceItem(src, getTree(), filePath)?.file;
      return file && !file.isDirectory ? file : null;
    };
    const report = (message: string) =>
      notify({
        id: crypto.randomUUID(),
        level: NotificationLevel.ERROR,
        title: "Image action failed",
        message,
        timestamp: Date.now(),
      });
    const open = (src: string) => {
      const file = resolve(src);
      if (file) setImageFile(file);
      else if (isRemoteImageSource(src))
        setImageFile({
          id: src,
          path: src,
          relativePath: src,
          filename: src.startsWith("http") ? src.split("/").pop()?.split("?")[0] || "Image" : "Image",
          isDirectory: false,
          mimeType: "image/*",
        });
      else report(`Could not find image '${src}'. Use Edit image source to update its path.`);
    };
    const run = async (action: () => Promise<unknown>) => {
      try {
        const result = await action();
        if (result && typeof result === "object" && "error" in result && typeof result.error === "string")
          report(result.error);
      } catch (error) {
        report(error instanceof Error ? error.message : String(error));
      }
    };
    return {
      resolveSource(src, syntax) {
        if (syntax === "markdown") return src;
        const tree = getTree();
        if (!resolvedWikiSources.has(src)) {
          resolvedWikiSources.set(src, resolveWikiImageWorkspaceFile(src, tree, filePath)?.relativePath ?? null);
        }
        return resolvedWikiSources.get(src) ?? null;
      },
      open,
      contextMenu(event, src, edit, remove) {
        const file = resolve(src);
        const preview = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLImageElement>("img");
        const entries: ContextMenuEntry[] = [
          { kind: "action", id: "image-view", label: "Open image viewer", icon: IconImage, onSelect: () => open(src) },
          { kind: "action", id: "image-source", label: "Edit image source", icon: IconCode, onSelect: edit },
          {
            kind: "action",
            id: "image-copy",
            label: "Copy image path",
            icon: IconCopy,
            onSelect: () => run(() => navigator.clipboard.writeText(src)),
          },
          {
            kind: "action",
            id: "image-copy-bitmap",
            label: "Copy image",
            icon: IconCopy,
            disabled: !preview?.complete || !preview.naturalWidth,
            onSelect: () => (preview ? run(() => copyRenderedImage(preview)) : undefined),
          },
          { kind: "separator" },
          {
            kind: "action",
            id: "image-external",
            label: "Open externally",
            icon: IconImage,
            disabled: !file && !/^https?:/i.test(src),
            onSelect: () =>
              file ? run(() => openInDefaultApp(file.path)) : run(() => window.api.openExternalLink(src)),
          },
          {
            kind: "action",
            id: "image-reveal",
            label: "Show in file manager",
            icon: IconFolderOpen,
            disabled: !file,
            onSelect: () => (file ? run(() => revealInSystemFileManager(file.path)) : undefined),
          },
          {
            kind: "action",
            id: "image-export",
            label: "Save a copy",
            icon: IconFileExport,
            disabled: !file,
            onSelect: () => (file ? run(() => exportWorkspaceFileCopy(file.path)) : undefined),
          },
          { kind: "separator" },
          {
            kind: "action",
            id: "image-remove",
            label: "Remove image from note",
            icon: IconTrash,
            danger: true,
            onSelect: remove,
          },
        ];
        openMenu({
          key: `image:${filePath}:${src}`,
          anchor: event.currentTarget as HTMLElement,
          position: { x: event.clientX, y: event.clientY },
          entries,
        });
      },
    };
  }, [filePath, openMenu, notify, store]);
  return {
    imageActions,
    imageViewer: imageFile ? (
      <ImageViewer key={imageFile.path} file={imageFile} modalOnly onClose={() => setImageFile(null)} />
    ) : null,
  };
}
