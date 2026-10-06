import { waitForBackgroundWorkspaceOperation } from "@renderer/store/workspaceTransitionStore";
import { useEffect } from "react";
import { useStore } from "jotai";

import { readTextFile } from "@renderer/features/files/workspaceFileService";
import { waitForPendingFileSaves } from "@renderer/features/files/dirtyFileBuffers";
import { fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { fileConflictReviewRequestAtom, fileSaveStatesByPathAtom } from "@renderer/store/fileSaveStore";
import { reloadRevisionAtom } from "@renderer/store/fileExplorerStore";
import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { workspaceFileVersionsEqual } from "@shared/file-item";
import { isPathWithinBase } from "@shared/pathUtils";
import type { WorkspaceFileChange } from "@shared/workspace-change";

const matchesChange = (filePath: string, change: WorkspaceFileChange) =>
  !change.path || filePath === change.path || (change.kind === "rename" && isPathWithinBase(filePath, change.path));

export const useWorkspaceFileChanges = (enabled: boolean) => {
  const store = useStore();

  useEffect(() => {
    if (!enabled) return;

    return window.api.onWorkspaceFilesChanged((changes) => {
      store.set(reloadRevisionAtom, (revision) => revision + 1);
      const openPaths = Object.keys(store.get(fileBuffersByPathAtom));
      const affectedPaths = openPaths.filter((filePath) => changes.some((change) => matchesChange(filePath, change)));

      for (const filePath of affectedPaths) {
        void waitForBackgroundWorkspaceOperation()
          .then(() => waitForPendingFileSaves(filePath))
          .then(() => readTextFile(filePath))
          .then((result) => {
            const buffer = store.get(fileBuffersByPathAtom)[filePath];
            if (!buffer) return;

            if (result.success) {
              if (buffer.version && workspaceFileVersionsEqual(buffer.version, result.version)) return;
              if (buffer.savedText === result.content) {
                store.set(fileBuffersByPathAtom, (buffers) => ({
                  ...buffers,
                  [filePath]: { ...buffer, version: result.version },
                }));
                return;
              }
            }

            const message = result.success
              ? "This note changed outside Obim. Review the editor and disk versions before continuing."
              : "This open note was moved, deleted, or became unavailable outside Obim. Its editor content is still safe.";
            const existing = store.get(fileSaveStatesByPathAtom)[filePath];
            if (existing?.phase === "conflict" && existing.message === message) return;

            store.set(fileSaveStatesByPathAtom, (states) => ({
              ...states,
              [filePath]: { phase: "conflict", message },
            }));
            store.set(addNotificationAtom, {
              id: crypto.randomUUID(),
              level: NotificationLevel.WARNING,
              title: result.success ? "Note changed on disk" : "Open note is unavailable",
              path: filePath,
              message,
              timestamp: Date.now(),
              timeout: 0,
              action: {
                label: "Review",
                onClick: () => store.set(fileConflictReviewRequestAtom, { path: filePath }),
              },
            });
          });
      }
    });
  }, [enabled, store]);
};
