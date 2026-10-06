import { IconFileExport, IconFolderOpen, IconImage, IconMinus, IconPlus, IconRefresh } from "@pierre/icons";
import { useSetAtom } from "jotai";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { addNotificationAtom, NotificationLevel } from "@renderer/store/NotificationsStore";
import { Button } from "@renderer/shared/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@renderer/shared/ui/dialog";
import type { FileItem } from "@shared/file-item";
import { imageSourceUrl, isRemoteImageSource } from "./imageSource";

import { exportWorkspaceFileCopy, openInDefaultApp, revealInSystemFileManager } from "./workspaceFileService";
import "./ImageViewer.css";

type ImageFile = Extract<FileItem, { isDirectory: false }>;
type ViewerMode = "fit" | "scaled";

const clampZoom = (value: number) => Math.max(0.1, Math.min(8, value));

export const ImageViewer = ({
  file,
  modalOnly = false,
  onClose,
}: {
  file: ImageFile;
  modalOnly?: boolean;
  onClose?: () => void;
}) => {
  const addNotification = useSetAtom(addNotificationAtom);
  const viewportRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ left: number; top: number; x: number; y: number } | null>(null);
  const [open, setOpen] = useState(modalOnly);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const [reloadRevision, setReloadRevision] = useState(0);
  const [mode, setMode] = useState<ViewerMode>("fit");
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const remote = isRemoteImageSource(file.relativePath);
  const source = file.relativePath
    ? `${imageSourceUrl(file.relativePath)}${remote ? "" : `?preview=${reloadRevision}`}`
    : "";

  const notifyError = (title: string, message: string) =>
    addNotification({
      id: crypto.randomUUID(),
      level: NotificationLevel.ERROR,
      title,
      message,
      path: file.path,
      timestamp: Date.now(),
    });

  const reveal = async () => {
    const result = await revealInSystemFileManager(file.path);
    if (!result.success) notifyError("Could not show image", result.error);
  };
  const openExternal = async () => {
    if (remote) {
      await window.api.openExternalLink(file.relativePath);
      return;
    }
    const result = await openInDefaultApp(file.path);
    if (!result.success) notifyError("Could not open image", result.error);
  };
  const saveCopy = async () => {
    const result = await exportWorkspaceFileCopy(file.path);
    if (result.status === "error") notifyError("Could not save a copy", result.error);
    if (result.status === "exported") {
      addNotification({
        id: crypto.randomUUID(),
        level: NotificationLevel.INFO,
        title: "Image copy saved",
        message: result.path,
        timestamp: Date.now(),
      });
    }
  };
  const changeZoom = (next: number) => {
    setMode("scaled");
    setZoom(clampZoom(next));
  };
  const retry = () => {
    setLoadState("loading");
    setReloadRevision((revision) => revision + 1);
  };
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mode === "fit" || event.button !== 0 || !viewportRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      left: viewportRef.current.scrollLeft,
      top: viewportRef.current.scrollTop,
      x: event.clientX,
      y: event.clientY,
    };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panRef.current || !viewportRef.current) return;
    viewportRef.current.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
    viewportRef.current.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
  };
  const stopPan = () => {
    panRef.current = null;
  };

  const image = (fullViewer: boolean) => (
    <img
      key={`${source}:${reloadRevision}:${fullViewer ? "full" : "pane"}`}
      src={source}
      alt={file.filename}
      draggable={false}
      className={
        fullViewer ? (mode === "fit" ? "image-viewer-image-fit" : "image-viewer-image-scaled") : "image-preview-image"
      }
      style={
        fullViewer && mode === "scaled" && naturalSize.width
          ? { width: naturalSize.width * zoom, height: naturalSize.height * zoom }
          : undefined
      }
      onLoad={(event) => {
        setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
        setLoadState("loaded");
      }}
      onError={() => setLoadState("error")}
    />
  );

  return (
    <>
      {!modalOnly && (
        <section className="image-preview" aria-label={`Image preview for ${file.filename}`}>
          <div className="image-preview-toolbar">
            <span className="image-preview-meta">
              <IconImage size={14} aria-hidden="true" />
              {naturalSize.width ? `${naturalSize.width} × ${naturalSize.height}` : "Image"}
            </span>
            <Button type="button" variant="ghost" size="xs" disabled={remote} onClick={() => void saveCopy()}>
              <IconFileExport size={14} aria-hidden="true" />
              Save a copy
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={remote}
              onClick={() => void reveal()}
              aria-label="Show image in file manager"
              title="Show in file manager"
            >
              <IconFolderOpen size={14} aria-hidden="true" />
            </Button>
          </div>
          {loadState === "error" ? (
            <div className="image-preview-trigger image-preview-trigger-error">
              <div className="image-preview-error" role="alert">
                <strong>Image could not be loaded</strong>
                <span>Check that the file still exists and is a supported image.</span>
                <Button type="button" size="xs" variant="outline" onClick={retry}>
                  <IconRefresh size={14} aria-hidden="true" />
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="image-preview-trigger"
              onClick={() => setOpen(true)}
              aria-label={`Open full image viewer for ${file.filename}`}
            >
              {loadState === "loading" ? (
                <span className="image-preview-status" role="status">
                  Loading image…
                </span>
              ) : null}
              {image(false)}
            </button>
          )}
        </section>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClose?.();
        }}
      >
        <DialogContent className="image-viewer-dialog" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Preview {file.filename}</DialogTitle>
          <header className="image-viewer-header">
            <div className="image-viewer-title">
              <strong>{file.filename}</strong>
              <span>{naturalSize.width ? `${naturalSize.width} × ${naturalSize.height}` : file.relativePath}</span>
            </div>
            <div className="image-viewer-controls" aria-label="Image controls">
              <Button
                type="button"
                variant={mode === "fit" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setMode("fit")}
              >
                Fit
              </Button>
              <Button
                type="button"
                variant={mode === "scaled" && zoom === 1 ? "secondary" : "ghost"}
                size="xs"
                onClick={() => {
                  setMode("scaled");
                  setZoom(1);
                }}
              >
                Actual size
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => changeZoom(zoom - 0.1)}
                aria-label="Zoom out"
              >
                <IconMinus size={14} />
              </Button>
              <span className="image-viewer-zoom" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => changeZoom(zoom + 0.1)}
                aria-label="Zoom in"
              >
                <IconPlus size={14} />
              </Button>
              <span className="image-viewer-separator" aria-hidden="true" />
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={remote && !/^https?:/i.test(file.relativePath)}
                onClick={() => void openExternal()}
              >
                Open externally
              </Button>
              <Button type="button" variant="ghost" size="xs" disabled={remote} onClick={() => void reveal()}>
                Reveal
              </Button>
              <Button type="button" variant="ghost" size="xs" disabled={remote} onClick={() => void saveCopy()}>
                Save a copy
              </Button>
            </div>
          </header>
          <div
            ref={viewportRef}
            className="image-viewer-viewport"
            data-pannable={mode === "scaled" ? "true" : undefined}
            tabIndex={0}
            aria-label="Image canvas. Use arrow keys to pan and plus or minus to zoom."
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onKeyDown={(event) => {
              if (event.key === "+" || event.key === "=") {
                event.preventDefault();
                changeZoom(zoom + 0.1);
              } else if (event.key === "-") {
                event.preventDefault();
                changeZoom(zoom - 0.1);
              } else if (event.key === "0") {
                event.preventDefault();
                setMode("fit");
                setZoom(1);
              } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault();
                viewportRef.current?.scrollBy({
                  left: event.key === "ArrowLeft" ? -60 : event.key === "ArrowRight" ? 60 : 0,
                  top: event.key === "ArrowUp" ? -60 : event.key === "ArrowDown" ? 60 : 0,
                });
              }
            }}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              changeZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
            }}
          >
            {loadState === "error" ? (
              <div className="image-viewer-error" role="alert">
                <strong>Image could not be loaded</strong>
                <span>Check that the file still exists and is a supported image.</span>
                <Button type="button" size="xs" variant="outline" onClick={retry}>
                  <IconRefresh size={14} aria-hidden="true" />
                  Retry
                </Button>
              </div>
            ) : mode === "scaled" && naturalSize.width ? (
              <div
                className="image-viewer-stage"
                style={{ width: naturalSize.width * zoom, height: naturalSize.height * zoom }}
              >
                {loadState === "loading" ? (
                  <span className="image-preview-status" role="status">
                    Loading image…
                  </span>
                ) : null}
                {image(true)}
              </div>
            ) : (
              <>
                {loadState === "loading" ? (
                  <span className="image-preview-status" role="status">
                    Loading image…
                  </span>
                ) : null}
                {image(true)}
              </>
            )}
          </div>
          <footer className="image-viewer-footer">
            Drag to pan at actual size · Ctrl/⌘ + wheel to zoom · Arrow keys to pan
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
};
