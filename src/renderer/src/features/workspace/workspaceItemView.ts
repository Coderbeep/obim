import type { ComponentType, ReactNode } from "react";

import type { ContextMenuEntry } from "@renderer/shared/contextMenu";
import { basename, stripLastExt } from "@shared/pathUtils";
import { WORKSPACE_ITEM_KINDS, parseWorkspaceItemKey, type WorkspaceItem } from "@shared/workspace";

type WorkspaceTabIcon = ComponentType<{ size?: number }>;

/** Describes how one kind of workspace item is presented and managed in a pane. */
export interface WorkspaceItemView {
  /** Returns the visual shown while dragging the item's tab. */
  getDragIcon?: (item: WorkspaceItem) => ReactNode;
  /** Returns the icon component displayed beside the tab title. */
  getTabIcon?: (item: WorkspaceItem) => WorkspaceTabIcon | null;
  /** Returns the title displayed in workspace tabs and pane headers. */
  getTitle: (item: WorkspaceItem) => string;
  /** Indicates whether the pane should use its editor-specific content layout. */
  isEditorContent?: (item: WorkspaceItem) => boolean;
  /** Indicates that the rendered view owns its scrolling and must receive the full pane width. */
  managesOwnOverflow?: (item: WorkspaceItem) => boolean;
  /** Adds item-specific actions to the standard workspace-tab menu. */
  getTabMenuEntries?: (item: WorkspaceItem, location: { paneId: string; tabId: string }) => ContextMenuEntry[];
  /** Renders the item's main pane content. */
  render: (item: WorkspaceItem, paneId: string) => ReactNode;
  /** Renders the pane header above the item's content. */
  renderHeader?: (item: WorkspaceItem, paneId: string) => ReactNode;
}

/** Workspace item views indexed by their corresponding item kind. */
export type WorkspaceItemViewMap = Readonly<Record<string, WorkspaceItemView>>;

/** Returns the registered view for an item, or `null` when none is available. */
export const getWorkspaceItemView = (views: WorkspaceItemViewMap, item?: WorkspaceItem | null) =>
  item ? (views[item.kind] ?? null) : null;

/** Returns an item's view title, falling back to a title derived from its key. */
export const getWorkspaceItemTitle = (
  views: WorkspaceItemViewMap,
  item?: WorkspaceItem | null,
  workspaceItemKey?: string,
) => {
  const view = getWorkspaceItemView(views, item);
  if (item && view) return view.getTitle(item);
  if (!workspaceItemKey) return "";

  const parsed = parseWorkspaceItemKey(workspaceItemKey);
  if (!parsed) return stripLastExt(basename(workspaceItemKey));
  if (parsed.kind === WORKSPACE_ITEM_KINDS.taskboard) return "Task Board";
  if (parsed.kind === WORKSPACE_ITEM_KINDS.file) return stripLastExt(basename(parsed.id));
  if (parsed.kind === WORKSPACE_ITEM_KINDS.fileHistory) return `Git · ${stripLastExt(basename(parsed.id))}`;
  if (parsed.kind === WORKSPACE_ITEM_KINDS.gitConflict) return `Resolve · ${basename(parsed.id)}`;
  return parsed.id || workspaceItemKey;
};
