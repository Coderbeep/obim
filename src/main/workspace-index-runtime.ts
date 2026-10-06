/**
 * Owns the active workspace index and watcher, reopening and synchronizing
 * them when the configured workspace or mutation revision changes.
 */
import crypto from "crypto";
import { app, BrowserWindow } from "electron";
import path from "path";

import ConfigManager from "./app-config";
import { mapWithConcurrency } from "./async-pool";
import { WorkspaceIndex, WORKSPACE_INDEX_FILE_CONCURRENCY } from "./workspace-index";
import { WorkspaceIndexWatcher } from "./workspace-index-watcher";
import { getWorkspaceRevision, queueWorkspaceRead } from "./workspace-mutations";

type ActiveWorkspaceIndex = {
  index: WorkspaceIndex;
  revision: number;
  watcher: WorkspaceIndexWatcher;
  workspacePath: string;
};

let activeWorkspaceIndex: ActiveWorkspaceIndex | undefined;

const openWorkspaceIndex = (workspacePath: string) => {
  if (activeWorkspaceIndex?.workspacePath === workspacePath) return activeWorkspaceIndex;

  closeWorkspaceIndex();
  const workspaceId = crypto.createHash("sha256").update(workspacePath).digest("hex").slice(0, 16);
  const index = new WorkspaceIndex(
    path.join(app.getPath("userData"), `workspace-${workspaceId}.sqlite`),
    workspacePath,
  );
  const refresh = (operation: () => Promise<void>) => queueWorkspaceRead(operation);

  activeWorkspaceIndex = {
    index,
    watcher: new WorkspaceIndexWatcher(
      workspacePath,
      (paths) =>
        refresh(async () => {
          await mapWithConcurrency(paths, WORKSPACE_INDEX_FILE_CONCURRENCY, (changedPath) =>
            index.refreshPath(changedPath),
          );
        }),
      () => refresh(() => index.sync()),
      (changes) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("workspace-files-changed", changes);
        }
      },
    ),
    revision: -1,
    workspacePath,
  };
  return activeWorkspaceIndex;
};

export const getWorkspaceIndex = async () => {
  const workspacePath = await ConfigManager.getConfigValue("mainDirectory");
  const active = openWorkspaceIndex(workspacePath);
  const revision = getWorkspaceRevision();
  if (active.revision !== revision) {
    await active.index.sync();
    active.revision = revision;
  }
  return active.index;
};

export const syncDegradedWorkspaceIndex = (): void => {
  const active = activeWorkspaceIndex;
  if (active?.watcher.degraded) void queueWorkspaceRead(() => active.index.sync());
};

export const closeWorkspaceIndex = (): void => {
  activeWorkspaceIndex?.watcher.close();
  activeWorkspaceIndex?.index.close();
  activeWorkspaceIndex = undefined;
};
