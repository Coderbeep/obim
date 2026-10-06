import type { WorkspaceItem } from "@shared/workspace";

/** Controls where and how a workspace item is opened. */
export interface OpenWorkspaceItemOptions {
  /** Moves DOM focus into the editor after opening an editable file. */
  focusEditor?: boolean;
  /** Opens the item in a new tab instead of replacing the current tab's item. */
  openInNewTab?: boolean;
  /** Targets a pane explicitly; otherwise the active pane is used. */
  paneId?: string;
  /** Commits a Back/Forward load and its history together. */
  historyDirection?: "back" | "forward";
  /** Prevents the opened item from being added to the tab's navigation history. */
  skipHistoryPush?: boolean;
  /** Skips saving the current editable item before opening the requested item. */
  skipSave?: boolean;
  /** Targets an existing tab explicitly. */
  targetTabId?: string;
}

/** Opens a workspace item and reports whether the operation completed successfully. */
export type OpenWorkspaceItem = (item: WorkspaceItem, options?: OpenWorkspaceItemOptions) => Promise<boolean>;

/** Resolves a workspace item key using the supplied collection of currently open items. */
export type WorkspaceItemResolver = (
  workspaceItemKey: string,
  openItemsByKey: Readonly<Record<string, WorkspaceItem>>,
) => WorkspaceItem | null;
