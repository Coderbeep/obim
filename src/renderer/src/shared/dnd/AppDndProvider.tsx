import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AppDragEntity } from "@shared/drag-data";

import { autoScrollAtPoint } from "./autoScroll";
import { registerAppDndBridge, type AppDndTargetUpdate } from "./bridge";
import { allowNativeDropCancellation } from "./nativeDropCancellation";
import { APP_DND_CONFIG } from "./config";
import { DragPreviewSurface } from "./DragPreview";

/** Content rendered in the canonical drag overlay. */
export type AppDragPreview = { icon?: ReactNode; subtext?: ReactNode; text: ReactNode };
type DragPoint = { x: number; y: number };
type DragSession = {
  entity: AppDragEntity;
  onCancel?: () => void;
  onFinish?: () => void;
};
type TargetState = AppDndTargetUpdate;

interface StartDragInput {
  entity: AppDragEntity;
  event: Pick<DragEvent, "clientX" | "clientY"> | Pick<React.DragEvent, "clientX" | "clientY">;
  onCancel?: () => void;
  onFinish?: () => void;
  preview: AppDragPreview;
}

interface AppDndActions {
  /**
   * Native adapter guard: rejects cancellation or a mismatched active kind.
   * Allows no active session for Pierre's delayed completion callback.
   */
  canCommit(kind?: AppDragEntity["kind"]): boolean;
  /** Cancels the drag and runs feature cleanup. */
  cancel(): void;
  /** Completes the drag and clears shared state. */
  complete(): void;
  /** Handles native `dragend`; an uncommitted drag is cancelled. */
  endDrag(): void;
  /** Returns the active semantic object without subscribing to drag state. */
  getActiveEntity(): AppDragEntity | null;
  getTarget(): TargetState | null;
  subscribeEnd(listener: () => void): () => void;
  subscribeTarget(listener: (target: TargetState | null) => void): () => void;
  /** Registers an internal drag and its canonical preview. */
  startDrag(input: StartDragInput): void;
  /** Publishes or clears the current semantic drop target. */
  updateTarget(update: TargetState | null): void;
}

const AppDndActionsContext = createContext<AppDndActions | null>(null);
const fallbackActions: AppDndActions = {
  canCommit: () => true,
  cancel: () => undefined,
  complete: () => undefined,
  endDrag: () => undefined,
  getActiveEntity: () => null,
  getTarget: () => null,
  subscribeEnd: () => () => undefined,
  subscribeTarget: () => () => undefined,
  startDrag: () => undefined,
  updateTarget: () => undefined,
};

/**
 * Provides the application drag lifecycle and canonical overlay.
 *
 * Mount this once around the renderer. Domain mutations must remain in feature
 * hooks and drop handlers.
 *
 * @param children Renderer content that can participate in drag and drop.
 * @returns The renderer content with shared DnD state and accessibility UI.
 */
export const AppDndProvider = ({ children }: { children: ReactNode }) => {
  const [overlay, setOverlay] = useState<AppDragPreview | null>(null);
  const [target, setTarget] = useState<TargetState | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const pointerRef = useRef<DragPoint>({ x: 0, y: 0 });
  const targetRef = useRef<TargetState | null>(null);
  const targetUpdateSequenceRef = useRef(0);
  const cancelledRef = useRef(false);
  const postDragPointRef = useRef<DragPoint | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const endListenersRef = useRef(new Set<() => void>());
  const targetListenersRef = useRef(new Set<(target: TargetState | null) => void>());

  const clearPostDragHover = useCallback(() => {
    postDragPointRef.current = null;
    delete document.documentElement.dataset.appDragJustEnded;
  }, []);

  const finishSession = useCallback((outcome: "completed" | "cancelled") => {
    const session = sessionRef.current;
    if (!session) return;
    // Detach before callbacks so recursive or repeated termination is harmless.
    sessionRef.current = null;
    cancelledRef.current = outcome === "cancelled";
    targetRef.current = null;
    delete document.documentElement.dataset.appDragKind;
    setOverlay(null);
    setTarget(null);
    if (session.entity.kind !== "external-files") {
      postDragPointRef.current = { ...pointerRef.current };
      document.documentElement.dataset.appDragJustEnded = "true";
    }

    // Clear old zone feedback before source callbacks can start another session.
    // Deliver every cleanup even when one fails, then preserve the error for callers.
    const callbacks = [
      ...endListenersRef.current,
      outcome === "cancelled" ? session.onCancel : undefined,
      session.onFinish,
    ];
    const errors: unknown[] = [];
    for (const callback of callbacks) {
      try {
        callback?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Drag session cleanup failed");
  }, []);

  const startDrag = useCallback(
    ({ entity, event, onCancel, onFinish, preview }: StartDragInput) => {
      finishSession("cancelled");
      // A callback-created session is the newer request. Clean this skipped source instead of overwriting it.
      if (sessionRef.current) {
        try {
          onCancel?.();
        } finally {
          onFinish?.();
        }
        return;
      }
      clearPostDragHover();
      sessionRef.current = { entity, onCancel, onFinish };
      pointerRef.current = { x: event.clientX, y: event.clientY };
      targetRef.current = null;
      cancelledRef.current = false;
      document.documentElement.dataset.appDragKind = entity.kind;
      setOverlay(entity.kind === "external-files" ? null : preview);
      setTarget(null);
    },
    [clearPostDragHover, finishSession],
  );

  const updateTarget = useCallback((update: TargetState | null) => {
    // A repeated publication still answers this dragover, even if feedback is unchanged.
    targetUpdateSequenceRef.current += 1;
    const current = targetRef.current;
    if (current?.valid === update?.valid && current?.key === update?.key && current?.label === update?.label) return;
    targetRef.current = update;
    setTarget(update);
    for (const listener of targetListenersRef.current) listener(update);
  }, []);

  const cancel = useCallback(() => finishSession("cancelled"), [finishSession]);
  const complete = useCallback(() => finishSession("completed"), [finishSession]);
  const endDrag = useCallback(() => {
    if (sessionRef.current) cancel();
    else cancelledRef.current = false;
  }, [cancel]);

  const canCommit = useCallback(
    (kind?: AppDragEntity["kind"]) =>
      !cancelledRef.current && (!kind || !sessionRef.current || sessionRef.current.entity.kind === kind),
    [],
  );
  const getActiveEntity = useCallback(() => sessionRef.current?.entity ?? null, []);
  const getTarget = useCallback(() => targetRef.current, []);
  const subscribeEnd = useCallback((listener: () => void) => {
    endListenersRef.current.add(listener);
    return () => {
      endListenersRef.current.delete(listener);
    };
  }, []);
  const subscribeTarget = useCallback((listener: (target: TargetState | null) => void) => {
    targetListenersRef.current.add(listener);
    return () => {
      targetListenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    registerAppDndBridge({ canCommit, complete, getActiveEntity, updateTarget });
    return () => registerAppDndBridge(null);
  }, [canCommit, complete, getActiveEntity, updateTarget]);

  // Native session routing: capture observes events; bubble handles unclaimed internal drops.
  useEffect(() => {
    let externalEnterDepth = 0;
    let externalDropCleanupTimer: number | null = null;
    const detectExternalFiles = (event: DragEvent) => {
      if (!sessionRef.current && Array.from(event.dataTransfer?.types ?? []).includes("Files")) {
        externalEnterDepth = 0;
        startDrag({
          entity: { kind: "external-files", id: "external-files" },
          event,
          preview: { text: "External files" },
        });
      }
      if (sessionRef.current?.entity.kind === "external-files") externalEnterDepth += 1;
    };
    const leaveExternalFiles = (event: DragEvent) => {
      if (sessionRef.current?.entity.kind !== "external-files") return;
      // Native dragenter/dragleave pairs include descendants; only the final leave exits the document.
      externalEnterDepth = Math.max(0, externalEnterDepth - 1);
      // Descendant leave events can outnumber enter events when a native tree redraws.
      // Keep the session while the pointer is still in the document; zones handle their own exits.
      if (
        event.relatedTarget instanceof Node ||
        (event.clientX > 0 &&
          event.clientX < window.innerWidth &&
          event.clientY > 0 &&
          event.clientY < window.innerHeight)
      )
        return;
      if (externalEnterDepth === 0) cancel();
    };
    const finishExternalDrop = () => {
      const session = sessionRef.current;
      if (session?.entity.kind !== "external-files") return;
      // A consumed rejected drop may stop propagation without ending the session.
      // Native dispatch runs microtasks between listeners, so wait for the next task.
      // Successful handlers complete synchronously; never end a replacement session.
      if (externalDropCleanupTimer !== null) window.clearTimeout(externalDropCleanupTimer);
      externalDropCleanupTimer = window.setTimeout(() => {
        externalDropCleanupTimer = null;
        if (sessionRef.current === session) cancel();
      }, 0);
    };
    let targetUpdateSequenceBeforeEvent = 0;
    const captureTargetUpdateSequence = () => {
      targetUpdateSequenceBeforeEvent = targetUpdateSequenceRef.current;
    };
    const acceptUnclaimedDrag = (event: DragEvent) => {
      if (!sessionRef.current || sessionRef.current.entity.kind === "external-files" || event.defaultPrevented) return;
      event.preventDefault();
      allowNativeDropCancellation(event.dataTransfer);
      // Rejecting native adapters may publish without preventDefault. Preserve their current feedback.
      if (targetUpdateSequenceRef.current === targetUpdateSequenceBeforeEvent) updateTarget(null);
    };
    const cancelUnclaimedDrop = (event: DragEvent) => {
      if (!sessionRef.current || event.defaultPrevented) return;
      if (sessionRef.current.entity.kind !== "external-files") event.preventDefault();
      cancel();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("dragenter", detectExternalFiles, true);
    document.addEventListener("dragleave", leaveExternalFiles, true);
    document.addEventListener("dragover", captureTargetUpdateSequence, true);
    document.addEventListener("dragover", acceptUnclaimedDrag);
    document.addEventListener("drop", finishExternalDrop, true);
    document.addEventListener("drop", cancelUnclaimedDrop);
    document.addEventListener("dragend", endDrag, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onEscape, true);
    return () => {
      if (externalDropCleanupTimer !== null) window.clearTimeout(externalDropCleanupTimer);
      document.removeEventListener("dragenter", detectExternalFiles, true);
      document.removeEventListener("dragleave", leaveExternalFiles, true);
      document.removeEventListener("dragover", captureTargetUpdateSequence, true);
      document.removeEventListener("dragover", acceptUnclaimedDrag);
      document.removeEventListener("drop", finishExternalDrop, true);
      document.removeEventListener("drop", cancelUnclaimedDrop);
      document.removeEventListener("dragend", endDrag, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onEscape, true);
      cancel();
    };
  }, [cancel, endDrag, startDrag, updateTarget]);

  const positionOverlay = useCallback(() => {
    const { x, y } = pointerRef.current;
    if (overlayRef.current)
      overlayRef.current.style.transform = `translate3d(${x + APP_DND_CONFIG.overlayOffset}px, ${y + APP_DND_CONFIG.overlayOffset}px, 0)`;
  }, []);

  // Position newly mounted/repainted feedback from live coordinates, without putting them in React state.
  useLayoutEffect(positionOverlay, [overlay, target, positionOverlay]);
  useEffect(() => {
    const followPointer = (event: DragEvent) => {
      const session = sessionRef.current;
      if (!session || (!event.clientX && !event.clientY)) return;
      pointerRef.current = { x: event.clientX, y: event.clientY };
      positionOverlay();
      const insidePierreTree = event
        .composedPath()
        .some((entry) => entry instanceof Element && entry.classList.contains("pierre-file-tree"));
      if (session.entity.kind !== "explorer-item" || !insidePierreTree) autoScrollAtPoint(event.clientX, event.clientY);
    };
    document.addEventListener("drag", followPointer, true);
    document.addEventListener("dragover", followPointer, true);
    return () => {
      document.removeEventListener("drag", followPointer, true);
      document.removeEventListener("dragover", followPointer, true);
    };
  }, [positionOverlay]);

  // Native reorder can leave :hover on the replacement row until the pointer actually moves.
  useEffect(() => {
    const clearPostDragHoverOnMove = (event: PointerEvent) => {
      const point = postDragPointRef.current;
      if (point && Math.hypot(event.clientX - point.x, event.clientY - point.y) > 1) clearPostDragHover();
    };
    document.addEventListener("pointermove", clearPostDragHoverOnMove, true);
    document.addEventListener("pointerdown", clearPostDragHover, true);
    document.addEventListener("keydown", clearPostDragHover, true);
    return () => {
      document.removeEventListener("pointermove", clearPostDragHoverOnMove, true);
      document.removeEventListener("pointerdown", clearPostDragHover, true);
      document.removeEventListener("keydown", clearPostDragHover, true);
      clearPostDragHover();
    };
  }, [clearPostDragHover]);

  const actions = useMemo<AppDndActions>(
    () => ({
      canCommit,
      cancel,
      complete,
      endDrag,
      getActiveEntity,
      getTarget,
      subscribeEnd,
      subscribeTarget,
      startDrag,
      updateTarget,
    }),
    [
      canCommit,
      cancel,
      complete,
      endDrag,
      getActiveEntity,
      getTarget,
      subscribeEnd,
      subscribeTarget,
      startDrag,
      updateTarget,
    ],
  );

  return (
    <AppDndActionsContext.Provider value={actions}>
      {children}
      {overlay ? (
        <DragPreviewSurface
          ref={overlayRef}
          icon={overlay.icon}
          subtext={target ? (target.valid ? target.label : `Not allowed: ${target.label}`) : overlay.subtext}
          text={overlay.text}
        />
      ) : null}
    </AppDndActionsContext.Provider>
  );
};

/**
 * Returns stable drag lifecycle actions without subscribing to pointer state.
 *
 * @returns Actions for starting, targeting, completing, and cancelling a drag.
 */
export const useAppDndActions = () => {
  const value = useContext(AppDndActionsContext);
  return value ?? fallbackActions;
};
