import { useSetAtom } from "jotai";
import { useCallback } from "react";

import { activateWorkspaceResourceAtom } from "@renderer/store/workspaceActionStore";
import type { FileItem } from "@shared/file-item";
import { createFileHistoryWorkspaceItem } from "@shared/workspace";

/** Opens one deduplicated history workspace tab for a file. */
export const useFileHistoryOpen = () => {
  const activateResource = useSetAtom(activateWorkspaceResourceAtom);

  const openFileHistory = useCallback(
    (file: FileItem) => {
      if (file.isDirectory) return;
      const item = createFileHistoryWorkspaceItem(file);
      activateResource({ item, resourceKey: item.key });
    },
    [activateResource],
  );

  return { openFileHistory };
};
