import { useAtomValue } from "jotai";

import { explorerSelectionPathsAtom, fileTreeAtom } from "@renderer/store/fileExplorerStore";
import type { FileItem } from "@shared/file-item";

import { findItemNode } from "../fileTreeUtils";

export type FileMenuTarget = FileItem & {
  paneId?: string;
  tabId?: string;
};

export type FileMenuPlacement = {
  anchor: HTMLElement | null;
  x: number;
  y: number;
};

export const resolveContextTargets = (target: FileItem, selectedPaths: string[], fileTree: FileItem[]) => {
  if (selectedPaths.length <= 1 || !selectedPaths.includes(target.path)) return [target];

  const resolved = selectedPaths
    .map((path) => findItemNode(fileTree, path))
    .filter((item): item is FileItem => Boolean(item));
  return resolved.length > 0 ? resolved : [target];
};

export const useFileMenuTargets = () => {
  const selectedPaths = useAtomValue(explorerSelectionPathsAtom);
  const fileTree = useAtomValue(fileTreeAtom);
  return (target: FileItem) => resolveContextTargets(target, selectedPaths, fileTree);
};
