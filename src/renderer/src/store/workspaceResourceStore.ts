import { atom } from "jotai";

import type { FileItem } from "@shared/file-item";
import {
  getWorkspaceFilePathFromKey,
  isFileWorkspaceItem,
  resolveStoredWorkspaceItem,
  type WorkspaceItem,
} from "@shared/workspace";

import { activePaneIdAtom, workspacePanesAtom } from "./editorPaneStore";
import { workspaceTabsByIdAtom } from "./editorTabStore";

/** Resolved workspace items currently retained by open tabs, indexed by item key. */
export const openWorkspaceItemsByKeyAtom = atom<Record<string, WorkspaceItem>>({});

/** Key displayed by the active tab in the active pane, or an empty string when none exists. */
export const currentWorkspaceItemKeyAtom = atom((get) => {
  const panes = get(workspacePanesAtom);
  const pane = panes.find((candidate) => candidate.id === get(activePaneIdAtom)) ?? panes[0];
  const activeTabId = pane?.activeTabId ?? null;
  return activeTabId ? get(workspaceTabsByIdAtom)[activeTabId]?.currentResourceKey ?? "" : "";
});

/** Resolved workspace item displayed by the active tab, or `null` when unavailable. */
export const currentWorkspaceItemAtom = atom<WorkspaceItem | null>((get) => {
  const workspaceItemKey = get(currentWorkspaceItemKeyAtom);
  return workspaceItemKey ? resolveStoredWorkspaceItem(workspaceItemKey, get(openWorkspaceItemsByKeyAtom)) : null;
});

/** Absolute file path represented by the active workspace item, or an empty string for non-file items. */
export const currentFilePathAtom = atom((get) => getWorkspaceFilePathFromKey(get(currentWorkspaceItemKeyAtom)) ?? "");

/** File metadata represented by the active workspace item, or `null` for non-file items. */
export const currentFileAtom = atom<FileItem | null>((get) => {
  const item = get(currentWorkspaceItemAtom);
  return isFileWorkspaceItem(item) ? item.file : null;
});
