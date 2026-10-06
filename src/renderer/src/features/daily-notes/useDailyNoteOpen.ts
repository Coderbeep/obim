import { useStore } from "jotai";
import { useCallback } from "react";

import { getDailyNoteCreationDirectory, getWorkspacePath } from "@renderer/config";
import { useFileCreate, useFileOpen, useFileRemove } from "@renderer/features/files/fileActions";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { workspacePanesAtom } from "@renderer/store/editorPaneStore";
import { workspaceTabsByIdAtom } from "@renderer/store/editorTabStore";
import { workspaceFilesAtom } from "@renderer/store/fileExplorerStore";
import { activateWorkspaceTabAtom } from "@renderer/store/workspaceActionStore";
import { joinFsPath } from "@shared/pathUtils";
import { createFileWorkspaceItemKey } from "@shared/workspace";

import { dailyNoteFilename, dailyNoteInitialContent, dailyNoteRelativePath } from "./dailyNotes";

export const useDailyNoteOpen = () => {
  const store = useStore();
  const { createMarkdownFile } = useFileCreate();
  const { open } = useFileOpen();
  const { remove } = useFileRemove();

  return useCallback(
    async (date: Date, directory?: string) => {
      directory ??= await getDailyNoteCreationDirectory();
      const dateKey = dailyNoteFilename(date);
      const relativePath = dailyNoteRelativePath(date, directory);
      const absolutePath = joinFsPath(getWorkspacePath(), relativePath);
      const resourceKey = createFileWorkspaceItemKey(absolutePath);
      const existingTab = Object.values(store.get(workspaceTabsByIdAtom)).find(
        (tab) => tab.currentResourceKey === resourceKey,
      );
      const existingPane = existingTab
        ? store.get(workspacePanesAtom).find((pane) => pane.tabs.includes(existingTab.id))
        : null;
      if (existingTab && existingPane) {
        store.set(activateWorkspaceTabAtom, { paneId: existingPane.id, tabId: existingTab.id });
        return;
      }

      const existing = store
        .get(workspaceFilesAtom)
        .find((file) => file.relativePath.replaceAll("\\", "/") === relativePath);
      if (existing) {
        await open(existing, { focusEditor: true, openInNewTab: true });
        return;
      }
      const created = await createMarkdownFile(
        joinFsPath(getWorkspacePath(), directory),
        dateKey,
        dailyNoteInitialContent(date),
        true,
        { openInNewTab: true },
      );
      if (created) {
        store.set(addNotificationAtom, {
          id: crypto.randomUUID(),
          level: NotificationLevel.INFO,
          title: "Daily note created",
          message: `Created ${created.relativePath}.`,
          path: created.path,
          action: {
            label: "Undo",
            onClick: async () => {
              await remove(created);
            },
          },
          timeout: 8000,
          timestamp: Date.now(),
        });
      }
    },
    [store, createMarkdownFile, open, remove],
  );
};
