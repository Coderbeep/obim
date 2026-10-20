import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import type { GitStatusEntry } from "@pierre/trees";

import { useFileOpen, useFileRemove } from "../fileActions";
import { useDirectoryMenu } from "../menus/useDirectoryMenu";
import { useFileMenu } from "../menus/useFileMenu";
import { useFileClipboard } from "../useFileClipboard";
import { getWorkspacePath } from "@renderer/config";
import { FILE_DRAG_DATA_MIME } from "@shared/drag-data";
import type { FileItem } from "@shared/file-item";
import { PDF_FILE_GLYPH_ID } from "@renderer/shared/icons/FileGlyphs";
import { basename, getExt, withExt } from "@shared/pathUtils";
import { isMarkdownFile } from "@shared/mime-types";

import { useAppDropZone } from "@renderer/shared/dnd/useAppDropZone";
import {
  getFileTreeMoveIntent,
  getTreeDropDestination,
  getTreeDropTargetFromHoveredPath,
  getExplorerRowName,
  getPdfAttachmentTarget,
  getPdfNoteDropItems,
  isTreeDirectoryHandle,
  toTreePath,
} from "./fileExplorerTreeUtils";
import { useFileExplorerDnd } from "./useFileExplorerTreeDnd";
import { useFileExplorerModel } from "./useFileExplorerModel";
import { ExplorerTree } from "./tree/ExplorerTree";
import {
  getExplorerTreeEventTarget,
  getExplorerTreeRowElement,
  isExplorerTreeBackgroundEvent,
} from "./tree/explorerTreeDom";

interface FileExplorerTreeProps {
  className?: string;
  expandedDirectories?: Set<string>;
  onExpandedDirectoriesChange?: (directories: Set<string>) => void;
  items: FileItem[];
  gitStatus?: readonly GitStatusEntry[];
  enableFileMove?: boolean;
  onExternalFileDrop?: (files: File[], destinationDirectory: FileItem | null) => void;
  onExternalPdfNoteDrop?: (files: File[], pdf: FileItem) => void;
  syncSelection?: boolean;
}

export type FileExplorerTreeHandle = {
  toggleAllDirectories: () => void;
};

const ExternalDropRootClass = "obim-external-drop-root";
const ExternalDropTargetClass = "obim-external-drop-target";
const RootDropTarget = {
  directoryPath: null,
  flattenedSegmentPath: null,
  hoveredPath: null,
  kind: "root" as const,
};
const isExternalFileDrop = (event: React.DragEvent<HTMLElement>) => {
  const types = Array.from(event.dataTransfer.types ?? []);
  return types.includes("Files") && !types.includes(FILE_DRAG_DATA_MIME);
};

export const FileExplorerTree = forwardRef<FileExplorerTreeHandle, FileExplorerTreeProps>(function FileExplorerTree(
  {
    className,
    expandedDirectories,
    enableFileMove = false,
    gitStatus,
    items,
    onExternalFileDrop,
    onExternalPdfNoteDrop,
    onExpandedDirectoriesChange,
    syncSelection = false,
  },
  ref,
) {
  const { open } = useFileOpen();
  const { removeMany } = useFileRemove();
  const { openDirectoryMenuAt, openRootMenuAt } = useDirectoryMenu();
  const { openFileMenuAt } = useFileMenu({ explorer: true });
  const { copyItems, pasteClipboardData } = useFileClipboard();
  const pasteTargetPathRef = useRef<string | null>(null);
  const rootDirectoryPath = getWorkspacePath();

  const { expandedTreePaths, lookupRef, model, onDropCompleteRef, toggleAllDirectories } = useFileExplorerModel({
    enableFileMove,
    expandedDirectories,
    gitStatus,
    items,
    onExpandedDirectoriesChange,
    syncSelection,
  });

  useImperativeHandle(ref, () => ({ toggleAllDirectories }), [toggleAllDirectories]);

  const { dragSourceTreePathRef, attachNotesToPdf } = useFileExplorerDnd({
    enabled: enableFileMove,
    expandedTreePaths,
    lookupRef,
    model,
    onDropCompleteRef,
  });

  const handleActivateItem = useCallback(
    (file: FileItem) => {
      if (!file.isDirectory) {
        open(file, { focusEditor: true });
        return;
      }

      const treeItem = model.getItem(toTreePath(file));
      if (isTreeDirectoryHandle(treeItem)) treeItem.toggle();
    },
    [model, open],
  );

  const handleOpenFileInNewTab = useCallback(
    (file: FileItem) => {
      if (!file.isDirectory) open(file, { openInNewTab: true });
    },
    [open],
  );

  useEffect(() => {
    let frameId: number | null = null;
    let cleanup: (() => void) | null = null;
    let observer: MutationObserver | null = null;

    const attach = () => {
      const host = model.getFileTreeContainer();
      const eventTarget = host?.shadowRoot ?? host;
      if (!host || !eventTarget) {
        frameId = window.requestAnimationFrame(attach);
        return;
      }

      const handleContextMenu = (event: Event) => {
        if (!(event instanceof MouseEvent)) return;
        const treePath = getExplorerTreeEventTarget(event)?.rowPath;
        pasteTargetPathRef.current = treePath ?? null;
        const file = treePath ? lookupRef.current.byTreePath.get(treePath) : null;
        const anchor = treePath ? getExplorerTreeRowElement(model, treePath) : null;
        if (!treePath || !file || !anchor) {
          if (!isExplorerTreeBackgroundEvent(event, model)) return;

          event.preventDefault();
          model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
          openRootMenuAt({ anchor: null, x: event.clientX, y: event.clientY });
          return;
        }

        event.preventDefault();
        if (!model.getSelectedPaths().includes(treePath)) {
          model.getSelectedPaths().forEach((path) => model.getItem(path)?.deselect());
          model.getItem(treePath)?.select();
        }

        const placement = { anchor, x: event.clientX, y: event.clientY };
        if (file.isDirectory) openDirectoryMenuAt(file, placement);
        else openFileMenuAt(file, placement);
      };

      const getMarkdownRenameTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLInputElement) || !target.matches("[data-item-rename-input]")) return null;
        const row = target.closest<HTMLElement>("[data-type='item'][data-item-path]");
        const file = row?.dataset.itemPath ? lookupRef.current.byTreePath.get(row.dataset.itemPath) : null;
        const displayName =
          file && row?.dataset.itemPath ? getExplorerRowName(file, row.dataset.itemPath, lookupRef.current) : null;
        return row && file && displayName !== null ? { file, input: target } : null;
      };

      const syncMarkdownRows = () => {
        eventTarget.querySelectorAll<HTMLElement>("[data-type='item'][data-item-path]").forEach((row) => {
          const file = row.dataset.itemPath ? lookupRef.current.byTreePath.get(row.dataset.itemPath) : null;
          const displayName =
            file && row?.dataset.itemPath ? getExplorerRowName(file, row.dataset.itemPath, lookupRef.current) : null;

          if (displayName === null) {
            if (file && row.getAttribute("aria-label") !== basename(file.path))
              row.setAttribute("aria-label", basename(file.path));
            delete row.dataset.obimMarkdownFile;
            delete row.dataset.obimPdfGroup;
            row.querySelector("[data-obim-pdf-glyph]")?.remove();
            return;
          }

          const grouped = Boolean(row.dataset.itemPath && lookupRef.current.pdfGroups?.has(row.dataset.itemPath));
          if (grouped) {
            row.dataset.obimPdfGroup = "true";
            delete row.dataset.obimMarkdownFile;
            const label = row.querySelector("[data-item-section='decoration'] > span");
            if (label && !label.querySelector("[data-obim-pdf-glyph]")) {
              const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
              icon.dataset.obimPdfGlyph = "true";
              icon.setAttribute("viewBox", "0 0 16 16");
              icon.setAttribute("width", "16");
              icon.setAttribute("height", "16");
              icon.setAttribute("aria-hidden", "true");
              icon.style.cssText = "flex-shrink:0;margin-right:5px;vertical-align:middle";
              const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
              use.setAttribute("href", `#${PDF_FILE_GLYPH_ID}`);
              icon.append(use);
              label.prepend(icon);
            }
          } else {
            row.dataset.obimMarkdownFile = "true";
            delete row.dataset.obimPdfGroup;
            row.querySelectorAll("[data-obim-pdf-glyph]").forEach((icon) => icon.remove());
          }
          if (file && row.title !== file.relativePath) row.title = file.relativePath;
          if (row.getAttribute("aria-label") !== displayName) row.setAttribute("aria-label", displayName);

          const input = row.querySelector<HTMLInputElement>("[data-item-rename-input]");
          if (
            !input ||
            input.dataset.obimMarkdownRenamePrepared === "true" ||
            input.dataset.obimMarkdownRenameCommitting === "true"
          )
            return;
          input.dataset.obimMarkdownRenamePrepared = "true";
          if (input.value !== displayName) {
            input.value = displayName;
            input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          }
          input.setAttribute("aria-label", `Rename ${displayName}`);
          input.select();
        });
      };

      const restoreMarkdownExtension = (target: EventTarget | null) => {
        const renameTarget = getMarkdownRenameTarget(target);
        if (!renameTarget || !renameTarget.input.value.trim()) return;

        renameTarget.input.dataset.obimMarkdownRenameCommitting = "true";
        renameTarget.input.value = withExt(renameTarget.input.value, getExt(renameTarget.file.path));
        renameTarget.input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      };

      const handleRenameKeyDown = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key === "Enter") restoreMarkdownExtension(event.target);
      };

      const handleRenameBlur = (event: Event) => restoreMarkdownExtension(event.target);
      observer = new MutationObserver(syncMarkdownRows);
      observer.observe(eventTarget, {
        attributeFilter: ["data-item-path"],
        attributes: true,
        childList: true,
        subtree: true,
      });
      syncMarkdownRows();

      const getSelectedItems = () =>
        model
          .getSelectedPaths()
          .map((path) => lookupRef.current.byTreePath.get(path))
          .filter((item): item is FileItem => Boolean(item));

      const handleCopy = (event: Event) => {
        const clipboardData = (event as ClipboardEvent).clipboardData;
        if (!clipboardData) return;

        const selectedItems = getSelectedItems();
        if (copyItems(selectedItems, clipboardData)) event.preventDefault();
      };

      const handleMouseDown = (event: Event) => {
        pasteTargetPathRef.current = getExplorerTreeEventTarget(event)?.rowPath ?? null;
      };

      const handleKeyDown = (event: Event) => {
        if (!(event instanceof KeyboardEvent)) return;

        if (
          ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp"].includes(event.key)
        ) {
          pasteTargetPathRef.current = null;
          return;
        }

        const target = event.composedPath()[0];
        if (
          event.key !== "Delete" ||
          event.repeat ||
          (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea")))
        )
          return;

        const selectedItems = getSelectedItems();
        if (!selectedItems.length) return;

        event.preventDefault();
        event.stopPropagation();
        void removeMany(selectedItems);
      };

      const handlePaste = (event: Event) => {
        const clipboardData = (event as ClipboardEvent).clipboardData;
        if (!clipboardData) return;

        const destination = getTreeDropDestination(
          getTreeDropTargetFromHoveredPath(pasteTargetPathRef.current ?? model.getFocusedPath(), lookupRef.current),
          lookupRef.current,
          rootDirectoryPath,
        );
        if (destination && pasteClipboardData(clipboardData, destination.absolutePath)) {
          event.preventDefault();
        }
      };

      eventTarget.addEventListener("contextmenu", handleContextMenu);
      eventTarget.addEventListener("copy", handleCopy);
      eventTarget.addEventListener("keydown", handleKeyDown);
      eventTarget.addEventListener("keydown", handleRenameKeyDown, true);
      eventTarget.addEventListener("blur", handleRenameBlur, true);
      eventTarget.addEventListener("mousedown", handleMouseDown);
      eventTarget.addEventListener("paste", handlePaste);
      cleanup = () => {
        eventTarget.removeEventListener("contextmenu", handleContextMenu);
        eventTarget.removeEventListener("copy", handleCopy);
        eventTarget.removeEventListener("keydown", handleKeyDown);
        eventTarget.removeEventListener("keydown", handleRenameKeyDown, true);
        eventTarget.removeEventListener("blur", handleRenameBlur, true);
        eventTarget.removeEventListener("mousedown", handleMouseDown);
        eventTarget.removeEventListener("paste", handlePaste);
      };
    };

    attach();
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      cleanup?.();
    };
  }, [
    copyItems,
    items,
    lookupRef,
    model,
    openDirectoryMenuAt,
    openFileMenuAt,
    openRootMenuAt,
    pasteClipboardData,
    removeMany,
    rootDirectoryPath,
  ]);

  return (
    <FileExplorerTreeSurface
      className={className}
      dragSourceTreePathRef={dragSourceTreePathRef}
      enableFileMove={enableFileMove}
      lookupRef={lookupRef}
      model={model}
      onDropCompleteRef={onDropCompleteRef}
      onExternalFileDrop={onExternalFileDrop}
      onExternalPdfNoteDrop={onExternalPdfNoteDrop}
      onAttachNotes={attachNotesToPdf}
      onOpenItem={handleActivateItem}
      onOpenItemInNewTab={handleOpenFileInNewTab}
      rootDirectoryPath={rootDirectoryPath}
    />
  );
});

type FileExplorerModelState = ReturnType<typeof useFileExplorerModel>;
type FileExplorerDndState = ReturnType<typeof useFileExplorerDnd>;

const FileExplorerTreeSurface = ({
  className,
  dragSourceTreePathRef,
  enableFileMove,
  lookupRef,
  model,
  onDropCompleteRef,
  onExternalFileDrop,
  onExternalPdfNoteDrop,
  onAttachNotes,
  onOpenItem,
  onOpenItemInNewTab,
  rootDirectoryPath,
}: {
  className?: string;
  dragSourceTreePathRef: FileExplorerDndState["dragSourceTreePathRef"];
  enableFileMove: boolean;
  lookupRef: FileExplorerModelState["lookupRef"];
  model: FileExplorerModelState["model"];
  onDropCompleteRef: FileExplorerModelState["onDropCompleteRef"];
  onExternalFileDrop?: FileExplorerTreeProps["onExternalFileDrop"];
  onExternalPdfNoteDrop?: FileExplorerTreeProps["onExternalPdfNoteDrop"];
  onAttachNotes: FileExplorerDndState["attachNotesToPdf"];
  onOpenItem: (file: FileItem) => void;
  onOpenItemInNewTab: (file: FileItem) => void;
  rootDirectoryPath: string;
}) => {
  const externalDropTargetRef = useRef<HTMLElement | null>(null);
  const pdfDropTargetRef = useRef<HTMLElement | null>(null);

  const getInternalDraggedPaths = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const lookup = lookupRef.current;
      const dragData = event.dataTransfer.getData("text/plain");
      const dataTreePath = lookup.byAbsolutePath.get(dragData) ?? (lookup.byTreePath.has(dragData) ? dragData : null);
      const activeTreePath = dragSourceTreePathRef.current;
      const sourceTreePath = activeTreePath && lookup.byTreePath.has(activeTreePath) ? activeTreePath : dataTreePath;
      if (!sourceTreePath) return [];

      const selectedPaths = model.getSelectedPaths();
      return selectedPaths.includes(sourceTreePath) ? [...selectedPaths] : [sourceTreePath];
    },
    [dragSourceTreePathRef, lookupRef, model],
  );

  const clearExternalDropHighlight = useCallback(() => {
    externalDropTargetRef.current?.classList.remove(ExternalDropTargetClass);
    externalDropTargetRef.current = null;
    model.getFileTreeContainer()?.classList.remove(ExternalDropRootClass);
  }, [model]);

  const clearPdfDropHighlight = useCallback(() => {
    pdfDropTargetRef.current?.removeAttribute("data-pdf-note-drop");
    pdfDropTargetRef.current = null;
  }, []);

  useEffect(() => clearPdfDropHighlight, [clearPdfDropHighlight]);

  const pdfZone = useAppDropZone<HTMLElement, { pdf: FileItem; notes: FileItem[]; external: boolean; valid: boolean }>({
    accepts: (entity) => entity.kind === "explorer-item" || entity.kind === "external-files",
    resolve: (event, entity) => {
      const key = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath ?? null;
      const pdf = getPdfAttachmentTarget(key, lookupRef.current);
      if (!pdf) return null;
      const external = entity.kind === "external-files";
      const notes = external ? [] : getPdfNoteDropItems(getInternalDraggedPaths(event), pdf, lookupRef.current);
      const files = Array.from(event.dataTransfer.files);
      // OS drags protect filenames until drop. Known non-text types can still be rejected on hover.
      const externalNotes = files.length
        ? files.every((file) => isMarkdownFile(null, file.name))
        : Array.from(event.dataTransfer.items ?? []).every(
            (item) =>
              item.kind === "file" &&
              (!item.type || ["text/plain", "text/markdown", "text/x-markdown"].includes(item.type)),
          );
      const valid = external ? Boolean(onExternalPdfNoteDrop) && externalNotes : enableFileMove && notes.length > 0;
      return {
        key: `pdf-notes:${pdf.path}`,
        valid,
        label: external
          ? `Import notes into ${basename(pdf.path)}`
          : notes.length > 1
            ? `Attach ${notes.length} notes to ${basename(pdf.path)}`
            : `Attach note to ${basename(pdf.path)}`,
        operation: { pdf, notes, external, valid },
      };
    },
    onHover: (event, { pdf, external, valid }) => {
      clearPdfDropHighlight();
      const key = lookupRef.current.byAbsolutePath.get(pdf.path);
      const row = key ? getExplorerTreeRowElement(model, key) : null;
      if (row) {
        row.dataset.pdfNoteDrop = valid ? "valid" : "invalid";
        pdfDropTargetRef.current = row;
      }
      if (external && valid) event.dataTransfer.dropEffect = "copy";
    },
    onClear: clearPdfDropHighlight,
    onDrop: (event, { pdf, notes, external }) => {
      if (external) {
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onExternalPdfNoteDrop?.(files, pdf);
        return;
      } else return onAttachNotes(notes, pdf);
    },
  });

  const getExternalDropTargetTreePath = (event: React.DragEvent<HTMLElement>) => {
    const hoveredTreePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath ?? null;
    return (
      getTreeDropDestination(
        getTreeDropTargetFromHoveredPath(hoveredTreePath, lookupRef.current),
        lookupRef.current,
        rootDirectoryPath,
      )?.treePath ?? ""
    );
  };

  const updateExternalDropHighlight = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const targetTreePath = getExternalDropTargetTreePath(event);
      const targetElement = targetTreePath ? getExplorerTreeRowElement(model, targetTreePath) : null;

      if (externalDropTargetRef.current !== targetElement) {
        externalDropTargetRef.current?.classList.remove(ExternalDropTargetClass);
        targetElement?.classList.add(ExternalDropTargetClass);
        externalDropTargetRef.current = targetElement;
      }

      model.getFileTreeContainer()?.classList.toggle(ExternalDropRootClass, targetElement === null);
    },
    [model],
  );

  useEffect(() => clearExternalDropHighlight, [clearExternalDropHighlight]);

  const getExternalDropDestination = (event: React.DragEvent<HTMLElement>) => {
    const hoveredTreePath = getExplorerTreeEventTarget(event.nativeEvent)?.rowPath ?? null;
    return (
      getTreeDropDestination(
        getTreeDropTargetFromHoveredPath(hoveredTreePath, lookupRef.current),
        lookupRef.current,
        rootDirectoryPath,
      )?.directory ?? null
    );
  };

  const externalZone = useAppDropZone<HTMLElement, FileItem | null>({
    accepts: (entity) => entity.kind === "external-files",
    effect: "copy",
    resolve: (event) => {
      if (!onExternalFileDrop || !isExternalFileDrop(event)) return null;
      const destination = getExternalDropDestination(event);
      return {
        key: `external-file:${destination?.path ?? "root"}`,
        valid: true,
        label: destination?.filename || "Notes",
        operation: destination,
      };
    },
    onHover: updateExternalDropHighlight,
    onClear: clearExternalDropHighlight,
    onDrop: (event, destination) => {
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onExternalFileDrop?.(files, destination);
    },
  });

  const handleTreeDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      externalZone.handlers.onDrop(event);
    },
    [externalZone],
  );

  const handleCombinedTreeDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (getPdfAttachmentTarget(getExplorerTreeEventTarget(event.nativeEvent)?.rowPath ?? null, lookupRef.current)) {
        externalZone.clearHover();
        pdfZone.handlers.onDragOver(event);
        return;
      }
      pdfZone.clearHover();
      if (onExternalFileDrop && isExternalFileDrop(event)) {
        externalZone.handlers.onDragOver(event);
        return;
      }
      externalZone.clearHover();
      const isRootTarget = getExplorerTreeEventTarget(event.nativeEvent) === null;
      if (
        enableFileMove &&
        isRootTarget &&
        dragSourceTreePathRef.current &&
        getFileTreeMoveIntent(getInternalDraggedPaths(event), RootDropTarget, lookupRef.current, rootDirectoryPath)
      ) {
        event.preventDefault();
      }
    },
    [
      clearExternalDropHighlight,
      dragSourceTreePathRef,
      enableFileMove,
      getInternalDraggedPaths,
      lookupRef,
      model,
      onExternalFileDrop,
      rootDirectoryPath,
      externalZone,
      pdfZone,
    ],
  );

  const handleCombinedTreeDragLeave = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const rect = model.getFileTreeContainer()?.getBoundingClientRect();
      const isStillInsideTree =
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!isStillInsideTree) {
        externalZone.clearHover();
        pdfZone.clearHover();
      }
    },
    [externalZone, model, pdfZone],
  );

  const handleCombinedTreeDragEnd = useCallback(() => {
    externalZone.clearHover();
    pdfZone.clearHover();
  }, [externalZone, pdfZone]);

  const handleRootDropCapture = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (getPdfAttachmentTarget(getExplorerTreeEventTarget(event.nativeEvent)?.rowPath ?? null, lookupRef.current)) {
        pdfZone.handlers.onDrop(event);
        return;
      }
      if (
        !enableFileMove ||
        Array.from(event.dataTransfer.types ?? []).includes("Files") ||
        getExplorerTreeEventTarget(event.nativeEvent)
      )
        return;

      const draggedPaths = getInternalDraggedPaths(event);
      if (!getFileTreeMoveIntent(draggedPaths, RootDropTarget, lookupRef.current, rootDirectoryPath)) return;

      event.preventDefault();
      clearExternalDropHighlight();
      onDropCompleteRef.current({
        draggedPaths,
        operation: draggedPaths.length > 1 ? "batch" : "move",
        target: RootDropTarget,
      });
    },
    [
      clearExternalDropHighlight,
      dragSourceTreePathRef,
      enableFileMove,
      getInternalDraggedPaths,
      lookupRef,
      onDropCompleteRef,
      rootDirectoryPath,
      pdfZone,
    ],
  );

  return (
    <ExplorerTree
      model={model}
      itemsByPath={lookupRef.current.byTreePath}
      isExpandableFile={(key) => Boolean(lookupRef.current.pdfGroups?.has(key))}
      className={className}
      onOpenItem={onOpenItem}
      onOpenItemInNewTab={onOpenItemInNewTab}
      onDragOver={handleCombinedTreeDragOver}
      onDragLeave={handleCombinedTreeDragLeave}
      onDragEnd={handleCombinedTreeDragEnd}
      onDrop={handleTreeDrop}
      onDropCapture={handleRootDropCapture}
    />
  );
};
