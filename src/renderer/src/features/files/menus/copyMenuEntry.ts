import { IconCopy, IconLink, IconSignpost } from "@pierre/icons";

import type { ContextMenuAction } from "@renderer/shared/contextMenu";
import type { FileItem } from "@shared/file-item";

export const createCopyMenuEntry = (
  targets: FileItem[],
  copyItems: (items: FileItem[]) => unknown,
  copyAbsolutePaths: (items: FileItem[]) => unknown,
  copyRelativePaths: (items: FileItem[]) => unknown,
): ContextMenuAction => ({
  kind: "action",
  id: "copy-menu",
  label: "Copy",
  icon: IconCopy,
  onSelect: () => undefined,
  children: [
    {
      kind: "action",
      id: "copy",
      label: targets.length > 1 ? `${targets.length} items` : "Item",
      icon: IconCopy,
      onSelect: () => {
        copyItems(targets);
      },
    },
    {
      kind: "action",
      id: "copy-path",
      label: targets.length > 1 ? `${targets.length} absolute paths` : "Absolute path",
      icon: IconSignpost,
      onSelect: () => {
        copyAbsolutePaths(targets);
      },
    },
    {
      kind: "action",
      id: "copy-relative-path",
      label: targets.length > 1 ? `${targets.length} relative paths` : "Relative path",
      icon: IconLink,
      onSelect: () => {
        copyRelativePaths(targets);
      },
    },
  ],
});
