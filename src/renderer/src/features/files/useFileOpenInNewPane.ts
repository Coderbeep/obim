import { useStore } from "jotai";
import { useCallback } from "react";

import { createNewPaneId } from "@renderer/features/workspace/usePaneWorkspace";
import { activePaneIdAtom, workspacePanesAtom } from "@renderer/store/editorPaneStore";
import { insertWorkspacePaneAtom, removeEmptyWorkspacePaneAtom } from "@renderer/store/workspaceActionStore";
import type { FileItem } from "@shared/file-item";

import { useFileOpen } from "./fileActions";

export const useFileOpenInNewPane = () => {
  const store = useStore();
  const { open } = useFileOpen();

  return useCallback(
    async (file: FileItem) => {
      const targetPaneId = store.get(activePaneIdAtom);
      if (file.isDirectory || !store.get(workspacePanesAtom).some((pane) => pane.id === targetPaneId)) return false;
      const paneId = createNewPaneId();
      store.set(insertWorkspacePaneAtom, { targetPaneId, side: "right", paneId });
      let opened = false;
      try {
        opened = await open(file, { paneId, openInNewTab: true, focusEditor: true });
        return opened;
      } finally {
        if (!opened) store.set(removeEmptyWorkspacePaneAtom, paneId);
      }
    },
    [store, open],
  );
};
