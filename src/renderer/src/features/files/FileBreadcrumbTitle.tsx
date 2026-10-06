import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import { EditorView } from "@renderer/features/editor/codemirror-view";
import { fileTreeAtom, renamingRequestAtom } from "@renderer/store/fileExplorerStore";
import type { FileItem } from "@shared/file-item";
import { isValidFilename, stripLastExt } from "@shared/pathUtils";

import { buildTreeLookup, toDirectoryTreePath } from "./explorer/fileExplorerTreeUtils";
import { useFileRename } from "./fileActions";
import { useDirectoryMenu } from "./menus/useDirectoryMenu";
import { shakeElement } from "./shake";
import { useRevealInFileExplorer } from "./useRevealInFileExplorer";

export const FileBreadcrumbTitle = ({ file, isPaneActive }: { file: FileItem; isPaneActive: boolean }) => {
  const parts = file.relativePath.split("/").filter(Boolean);
  const parentParts = parts.slice(0, -1);
  const currentTitle = parts.length > 0 ? stripLastExt(parts[parts.length - 1]) : "";
  const fileTree = useAtomValue(fileTreeAtom);
  const directoryLookup = useMemo(() => buildTreeLookup(fileTree).byTreePath, [fileTree]);
  const revealInFileExplorer = useRevealInFileExplorer();
  const { openBreadcrumbDirectoryMenu } = useDirectoryMenu();
  const { saveRename, stopRenaming } = useFileRename();
  const renamingRequest = useAtomValue(renamingRequestAtom);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameRequested = renamingRequest?.target === "file-header" && renamingRequest.filePath === file.path;
  const editing = isEditing || renameRequested;
  const visibleDraftTitle = renameRequested && !isEditing ? currentTitle : draftTitle;

  const startEditing = useCallback(() => {
    setDraftTitle(currentTitle);
    setIsEditing(true);
  }, [currentTitle]);

  const cancelEditing = useCallback(() => {
    setDraftTitle(currentTitle);
    setIsEditing(false);
  }, [currentTitle]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!isPaneActive || editing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== "F2" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("input, textarea, select")) return;
      if (!target.closest(".pane-card-active")) return;

      event.preventDefault();
      startEditing();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editing, isPaneActive, startEditing]);

  if (parts.length === 0) return null;

  const submitRename = async () => {
    const nextTitle = draftTitle.trim();
    const pane = inputRef.current?.closest(".pane-card");
    if (isSubmitting) return;
    if (nextTitle === currentTitle) {
      cancelEditing();
      return;
    }
    if (!isValidFilename(nextTitle)) {
      shakeElement(inputRef.current);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await saveRename(file.path, nextTitle);
      if (result.success) {
        setIsEditing(false);
        const editorElement = pane?.querySelector<HTMLElement>(".cm-editor");
        if (editorElement) {
          const view = EditorView.findFromDOM(editorElement);
          view?.focus();
        }
        return;
      }
      shakeElement(inputRef.current);
    } catch {
      shakeElement(inputRef.current);
    } finally {
      setIsSubmitting(false);
    }
  };

  const revealParent = (index: number) => {
    const breadcrumbPath = parentParts.slice(0, index + 1).join("/");
    revealInFileExplorer(breadcrumbPath);
  };

  const openParentMenu = (event: MouseEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    const breadcrumbPath = parentParts.slice(0, index + 1).join("/");
    const directory = directoryLookup.get(toDirectoryTreePath(breadcrumbPath));
    if (directory?.isDirectory) openBreadcrumbDirectoryMenu(event, directory);
  };

  return (
    <div className={`pane-card-breadcrumb ${editing ? "pane-card-breadcrumb-editing" : ""}`} title={file.relativePath}>
      {parentParts.length > 0 ? (
        <span className="pane-card-breadcrumb-parents" aria-hidden={editing}>
          {parentParts.map((part, index) => (
            <span key={`${part}-${index}`} className="pane-card-breadcrumb-item">
              {index > 0 ? <span className="pane-card-breadcrumb-separator">/</span> : null}
              <button
                type="button"
                className="pane-card-breadcrumb-part"
                onClick={() => revealParent(index)}
                onContextMenu={(event) => openParentMenu(event, index)}
                tabIndex={editing ? -1 : 0}
              >
                {part}
              </button>
            </span>
          ))}
          <span className="pane-card-breadcrumb-separator">/</span>
        </span>
      ) : null}
      <span className="pane-card-breadcrumb-current-wrap">
        {editing ? (
          <input
            ref={inputRef}
            className="pane-card-breadcrumb-rename-input"
            value={visibleDraftTitle}
            size={Math.max(1, visibleDraftTitle.length)}
            readOnly={isSubmitting}
            onFocus={() => {
              if (!renameRequested) return;
              setDraftTitle(currentTitle);
              setIsEditing(true);
              stopRenaming(file.path);
            }}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => {
              if (!isSubmitting) cancelEditing();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
            aria-label="Rename current file"
          />
        ) : (
          <button type="button" className="pane-card-breadcrumb-current" onClick={startEditing}>
            {currentTitle}
          </button>
        )}
      </span>
    </div>
  );
};
