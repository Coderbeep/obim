import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

import { TASK_BOARD_CONFIG_RELATIVE_PATH } from "@shared/task-board-config";
import { isMarkdownFile } from "@shared/mime-types";
import type { WorkspaceFileChange } from "@shared/workspace-change";

export type WorkspaceIndexWatchAction = { kind: "reconcile" } | { kind: "refresh"; path: string } | null;

/** Maps a raw filesystem event to the smallest index operation that can make it current. */
export const classifyWorkspaceIndexWatchEvent = (
  workspacePath: string,
  event: string,
  filename: string | Buffer | null,
): WorkspaceIndexWatchAction => {
  if (!filename) return { kind: "reconcile" };

  const relative = filename.toString();
  if (relative.split(/[\\/]/u).some((part) => part.startsWith("."))) return null;
  if (isMarkdownFile(null, relative)) return { kind: "refresh", path: path.join(workspacePath, relative) };

  // A rename without an extension can be a directory move. Reconcile that
  // uncommon case; ordinary non-Markdown content changes do not affect the index.
  return event === "rename" && path.extname(relative) === "" ? { kind: "reconcile" } : null;
};

export const shouldBroadcastWorkspaceChange = (filename: string | undefined) => {
  if (!filename) return true;
  const relative = filename.replaceAll("\\", "/");
  return (
    relative === TASK_BOARD_CONFIG_RELATIVE_PATH ||
    relative === ".todo" ||
    !relative.split("/").some((part) => part.startsWith("."))
  );
};

export class WorkspaceIndexWatcher {
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private changed = new Set<string>();
  private workspaceChanges = new Map<string, WorkspaceFileChange>();
  degraded = false;

  constructor(
    workspacePath: string,
    private readonly refreshPaths: (paths: string[]) => Promise<void>,
    private readonly reconcile: () => Promise<void>,
    private readonly onWorkspaceChanged: (changes: WorkspaceFileChange[]) => void,
  ) {
    try {
      this.watcher = watch(workspacePath, { recursive: true }, (event, filename) => {
        const relative = filename?.toString();
        if (!shouldBroadcastWorkspaceChange(relative)) return;
        const changedPath = relative ? path.join(workspacePath, relative).replaceAll("\\", "/") : undefined;
        const change = {
          kind: filename ? event : "unknown",
          ...(changedPath ? { path: changedPath } : {}),
        } satisfies WorkspaceFileChange;
        this.workspaceChanges.set(`${change.kind}:${change.path ?? ""}`, change);

        const action = classifyWorkspaceIndexWatchEvent(workspacePath, event, filename);
        if (action) this.changed.add(action.kind === "reconcile" ? "" : action.path);
        this.schedule();
      });
      this.watcher.on("error", (error) => {
        this.degraded = true;
        console.warn("Workspace index watcher degraded:", error);
        this.closeWatcher();
      });
    } catch (error) {
      this.degraded = true;
      console.warn("Recursive workspace watching is unavailable:", error);
    }
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.closeWatcher();
  }

  private closeWatcher() {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const paths = [...this.changed];
      const workspaceChanges = [...this.workspaceChanges.values()];
      this.changed.clear();
      this.workspaceChanges.clear();
      if (workspaceChanges.length) this.onWorkspaceChanged(workspaceChanges);
      if (!paths.length) return;
      void (paths.includes("") ? this.reconcile() : this.refreshPaths(paths)).catch((error) =>
        console.warn("Workspace watcher refresh failed:", error),
      );
    }, 150);
  }
}
