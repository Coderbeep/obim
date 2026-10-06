import type { FileTree as FileTreeModel } from "@pierre/trees";
import { FileTree as TreesFileTree } from "@pierre/trees/react";
import { useCallback } from "react";

import { cn } from "@renderer/shared/classNames";

import { getExplorerTreeEventTarget } from "./explorerTreeDom";

export interface ExplorerTreeProps<T> {
  className?: string;
  itemsByPath: Map<string, T>;
  model: FileTreeModel;
  onClickCapture?: (event: React.MouseEvent<HTMLElement>) => void;
  onDrag?: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLElement>) => void;
  onDragLeave?: (event: React.DragEvent<HTMLElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLElement>) => void;
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLElement>) => void;
  onDropCapture?: (event: React.DragEvent<HTMLElement>) => void;
  onOpenItem?: (item: T) => void;
  onOpenItemInNewTab?: (item: T) => void;
}

export const ExplorerTree = <T,>({
  className,
  itemsByPath,
  model,
  onClickCapture,
  onDrag,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onDropCapture,
  onOpenItem,
  onOpenItemInNewTab,
}: ExplorerTreeProps<T>) => {
  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      onClickCapture?.(event);
      const captureWasHandled = event.defaultPrevented || event.isPropagationStopped();
      if (event.button !== 0) return;

      const treePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath;
      const item = treePath ? model.getItem(treePath) : null;
      if (!item || !("toggle" in item)) return;

      event.preventDefault();
      event.stopPropagation();
      const tree = model.getFileTreeContainer()?.shadowRoot?.querySelector<HTMLElement>("[role='tree']");
      queueMicrotask(() => tree?.focus());
      if (!captureWasHandled && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
        item.focus();
        item.select();
        item.toggle();
      }
    },
    [model, onClickCapture],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!onOpenItem || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;

      const treePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath;
      if (treePath && itemsByPath.has(treePath)) onOpenItem(itemsByPath.get(treePath) as T);
    },
    [itemsByPath, onOpenItem],
  );

  const handleMiddleMouseButton = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!onOpenItemInNewTab || event.button !== 1) return;

      const treePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath;
      if (!treePath || !itemsByPath.has(treePath)) return;

      event.preventDefault();
      event.stopPropagation();
    },
    [itemsByPath, onOpenItemInNewTab],
  );

  const handleAuxClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!onOpenItemInNewTab || event.button !== 1) return;

      const treePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath;
      if (!treePath || !itemsByPath.has(treePath)) return;

      event.preventDefault();
      event.stopPropagation();
      onOpenItemInNewTab(itemsByPath.get(treePath) as T);
    },
    [itemsByPath, onOpenItemInNewTab],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" && !event.repeat && onOpenItem) {
        const treePath = model.getFocusedPath();
        if (treePath && itemsByPath.has(treePath)) {
          event.preventDefault();
          event.stopPropagation();
          model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
          model.getItem(treePath)?.select();
          onOpenItem(itemsByPath.get(treePath) as T);
        }
      }
    },
    [itemsByPath, model, onOpenItem],
  );

  return (
    <TreesFileTree
      model={model}
      className={cn("pierre-file-tree", className)}
      onClickCapture={handleClickCapture}
      onClick={handleClick}
      onMouseDown={handleMiddleMouseButton}
      onMouseUp={handleMiddleMouseButton}
      onAuxClick={handleAuxClick}
      onKeyDown={handleKeyDown}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onDropCapture={onDropCapture}
    />
  );
};
