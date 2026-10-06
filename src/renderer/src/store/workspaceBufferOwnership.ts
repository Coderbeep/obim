import { getWorkspaceReferenceFilePathFromKey, type WorkspaceItem } from "@shared/workspace";
import type { Getter } from "jotai";
import { workspaceTabsByIdAtom } from "./editorTabStore";

export const getWorkspaceItemBufferPaths = (item: WorkspaceItem | string | null | undefined): string[] => {
  const key = typeof item === "string" ? item : item?.key;
  if (!key) return [];
  const path = getWorkspaceReferenceFilePathFromKey(key);
  return path ? [path] : [];
};

/** Include navigation history because removing the tab also removes that ownership. */
export const getWorkspaceTabBufferPaths = (get: Getter, tabId: string): string[] => {
  const tab = get(workspaceTabsByIdAtom)[tabId];
  if (!tab) return [];
  return [
    ...new Set(
      [tab.currentResourceKey, ...tab.backStack, ...tab.forwardStack].flatMap((key) =>
        getWorkspaceItemBufferPaths(key),
      ),
    ),
  ];
};
