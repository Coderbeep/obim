import "./TaskBoardTask.css";
import { LazyObimEditor as ObimEditor } from "@renderer/features/editor/editorLoader";
import { normalizeFileItemPath } from "@shared/pathUtils";
import { IconArrowUpRight, IconEllipsisSm, IconX } from "@pierre/icons";
import { Suspense, memo, useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useAtomValue, useStore } from "jotai";
import { getWorkspacePath } from "@renderer/config";
import { useFileOpen } from "@renderer/features/files/fileActions";
import { useFileHeaderMenu } from "@renderer/features/files/menus/useFileHeaderMenu";
import { readTextFile } from "@renderer/features/files/workspaceFileService";
import { saveDirtyFileBuffers } from "@renderer/features/files/dirtyFileBuffers";
import { fileBufferIdentitiesAtom, fileBuffersByPathAtom } from "@renderer/store/fileBufferStore";
import { hydrateFileBufferAtom } from "@renderer/store/fileLifecycleStore";
import { activePaneIdAtom, workspacePanesAtom, editorSubtaskRequestAtom } from "@renderer/store/editorPaneStore";
import { Button } from "@renderer/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@renderer/shared/ui/dialog";
import { type TaskBoardTask } from "./taskBoardModel";
import { type TaskNoteSubtaskTarget } from "@renderer/shared/taskNoteSubtasks";

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });
const MemoObimEditor = memo(ObimEditor);
type WindowInteraction = {
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  bounds: TaskNoteWindowBounds;
};

/** An editable task note above the board, sharing the normal note buffer and save lifecycle. */
export function TaskNoteHoverWindow({
  request,
  onClose,
}: {
  request: { task: TaskBoardTask; target?: TaskNoteSubtaskTarget };
  onClose: () => void;
}) {
  const store = useStore();
  const { open, openLinkedFile } = useFileOpen();
  const { openFileHeaderMenu } = useFileHeaderMenu();
  const { task: requestedTask, target } = request;
  const identities = useAtomValue(fileBufferIdentitiesAtom);
  const identity = useRef(identities[requestedTask.path]);
  if (!identity.current) identity.current = identities[requestedTask.path];
  const currentPath = identity.current
    ? Object.entries(identities).find(([, value]) => value === identity.current)?.[0]
    : undefined;
  const task =
    currentPath && currentPath !== requestedTask.path
      ? { ...requestedTask, ...normalizeFileItemPath(requestedTask, currentPath, getWorkspacePath()) }
      : requestedTask;
  const openResource = useCallback(
    async (path: string) => {
      await openLinkedFile(path, task.path);
    },
    [openLinkedFile, task.path],
  );
  const buffer = useAtomValue(fileBuffersByPathAtom)[task.path];
  const hasBuffer = Boolean(buffer);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bounds, setBounds] = useState(() => initialTaskNoteWindowBounds(viewportSize()));
  const interaction = useRef<WindowInteraction | null>(null);
  const [paneId] = useState(() => store.get(activePaneIdAtom) || store.get(workspacePanesAtom)[0]?.id || "");
  useEffect(() => {
    const fitToViewport = () => {
      interaction.current = null;
      setBounds((current) => fitTaskNoteWindowBounds(current, viewportSize()));
    };
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);
  const startInteraction = (event: PointerEvent<HTMLElement>, mode: WindowInteraction["mode"]) => {
    if (event.button !== 0) return;
    if (
      mode === "move" &&
      event.target instanceof Element &&
      event.target.closest("button, a, input, textarea, select")
    )
      return;
    event.preventDefault();
    interaction.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      bounds,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const updateInteraction = (event: PointerEvent<HTMLElement>) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    setBounds(
      active.mode === "move"
        ? moveTaskNoteWindowBounds(active.bounds, viewportSize(), dx, dy)
        : resizeTaskNoteWindowBounds(active.bounds, viewportSize(), dx, dy),
    );
  };
  const endInteraction = (event: PointerEvent<HTMLElement>) => {
    if (interaction.current?.pointerId !== event.pointerId) return;
    interaction.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  useEffect(() => {
    if (hasBuffer) return;
    let cancelled = false;
    const workspace = getWorkspacePath();
    setError(null);
    void readTextFile(task.path)
      .then((result) => {
        if (cancelled || getWorkspacePath() !== workspace) return;
        if (result.success) store.set(hydrateFileBufferAtom, task.path, result.content, result.version);
        else setError(result.error);
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not open this task.");
      });
    return () => {
      cancelled = true;
    };
  }, [task.path, hasBuffer, store, retry]);
  useEffect(() => {
    if (!target) return;
    const request = { filePath: task.path, paneId, target };
    store.set(editorSubtaskRequestAtom, request);
    return () => {
      store.set(editorSubtaskRequestAtom, (current) => (current === request ? null : current));
    };
  }, [store, task.path, target, paneId]);
  const finish = async (inTab = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveDirtyFileBuffers(store, (path) => path === task.path);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (inTab && !(await open(task))) {
        setError("Could not open the task in a tab.");
        return;
      }
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the task.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) void finish();
      }}
    >
      <DialogContent
        className="task-note-detail-window flex max-h-none max-w-none flex-col gap-0 overflow-hidden p-0"
        style={{
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          translate: "none",
          transform: "none",
        }}
        aria-describedby={undefined}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (event.target instanceof Element && event.target.closest("#context-menu")) event.preventDefault();
        }}
        showCloseButton={false}
        showOverlay={false}
      >
        <header
          className="task-note-window-drag-handle flex shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-3"
          onPointerDown={(event) => startInteraction(event, "move")}
          onPointerMove={updateInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
        >
          <DialogTitle className="min-w-0 truncate text-ui-item">{task.title}</DialogTitle>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Current file options"
              title="Current file options"
              onClick={(event) => openFileHeaderMenu(event, task)}
            >
              <IconEllipsisSm size={14} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open in tab"
              title="Open in tab"
              disabled={saving}
              onClick={() => void finish(true)}
            >
              <IconArrowUpRight size={14} aria-hidden="true" />
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close" disabled={saving}>
                <IconX size={14} aria-hidden="true" />
              </Button>
            </DialogClose>
          </div>
        </header>
        {error ? (
          <div role="alert" className="flex items-center gap-2 px-5 py-2 text-ui-control text-destructive">
            {error}
            {!buffer ? (
              <Button variant="ghost" size="xs" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden">
          {buffer ? (
            <Suspense
              fallback={
                <p role="status" className="p-5">
                  Opening editor…
                </p>
              }
            >
              <MemoObimEditor
                fileId={task.id}
                filePath={task.path}
                paneId={paneId}
                isMarkdown
                openResource={openResource}
              />
            </Suspense>
          ) : !error ? (
            <p role="status" className="p-5 text-ui-control">
              Opening note…
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="task-note-window-resize-handle"
          data-resize-handle
          aria-label="Resize task window"
          title="Drag to resize task window; use arrow keys when focused"
          onPointerDown={(event) => startInteraction(event, "resize")}
          onPointerMove={updateInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16;
            const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
            const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            setBounds((current) => resizeTaskNoteWindowBounds(current, viewportSize(), dx, dy));
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export type TaskNoteWindowBounds = { x: number; y: number; width: number; height: number };
export type TaskNoteViewport = { width: number; height: number };

const MARGIN = 16;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);

const availableSize = (viewport: TaskNoteViewport) => ({
  width: Math.max(1, viewport.width - MARGIN * 2),
  height: Math.max(1, viewport.height - MARGIN * 2),
});

export const initialTaskNoteWindowBounds = (viewport: TaskNoteViewport): TaskNoteWindowBounds => {
  const available = availableSize(viewport);
  const width = Math.min(768, available.width);
  const height = Math.min(760, Math.round(viewport.height * 0.85), available.height);
  return {
    x: Math.max(MARGIN, Math.round((viewport.width - width) / 2)),
    y: Math.max(MARGIN, Math.round((viewport.height - height) / 2)),
    width,
    height,
  };
};

export const fitTaskNoteWindowBounds = (
  bounds: TaskNoteWindowBounds,
  viewport: TaskNoteViewport,
): TaskNoteWindowBounds => {
  const available = availableSize(viewport);
  const width = clamp(bounds.width, Math.min(MIN_WIDTH, available.width), available.width);
  const height = clamp(bounds.height, Math.min(MIN_HEIGHT, available.height), available.height);
  return {
    x: clamp(bounds.x, MARGIN, Math.max(MARGIN, viewport.width - MARGIN - width)),
    y: clamp(bounds.y, MARGIN, Math.max(MARGIN, viewport.height - MARGIN - height)),
    width,
    height,
  };
};

export const moveTaskNoteWindowBounds = (
  bounds: TaskNoteWindowBounds,
  viewport: TaskNoteViewport,
  dx: number,
  dy: number,
) => fitTaskNoteWindowBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, viewport);

export const resizeTaskNoteWindowBounds = (
  bounds: TaskNoteWindowBounds,
  viewport: TaskNoteViewport,
  dx: number,
  dy: number,
): TaskNoteWindowBounds => {
  const maxWidth = Math.max(1, viewport.width - MARGIN - bounds.x);
  const maxHeight = Math.max(1, viewport.height - MARGIN - bounds.y);
  return {
    ...bounds,
    width: clamp(bounds.width + dx, Math.min(MIN_WIDTH, maxWidth), maxWidth),
    height: clamp(bounds.height + dy, Math.min(MIN_HEIGHT, maxHeight), maxHeight),
  };
};
