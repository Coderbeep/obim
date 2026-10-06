import { useEffect, useRef, useState, type DragEvent } from "react";

import type { AppDragEntity } from "@shared/drag-data";

import { useAppDndActions } from "./AppDndProvider";
import { allowNativeDropCancellation } from "./nativeDropCancellation";

export interface DropZoneResolution<Intent> {
  key: string;
  valid: boolean;
  label: string;
  operation: Intent;
}

interface DropZoneOptions<T extends HTMLElement, Intent> {
  accepts(entity: AppDragEntity): boolean;
  effect?: "copy" | "move";
  resolve(event: DragEvent<T>, entity: AppDragEntity): DropZoneResolution<Intent> | null;
  onDrop(event: DragEvent<T>, intent: Intent, entity: AppDragEntity): void | Promise<void>;
  onHover?(event: DragEvent<T>, intent: Intent, entity: AppDragEntity): void;
  onClear?(): void;
  domMarker?: boolean;
}

/** Owns the native target lifecycle for one destination element. */
export const useAppDropZone = <T extends HTMLElement, Intent>({
  accepts,
  effect = "move",
  resolve,
  onDrop,
  onHover,
  onClear,
  domMarker = false,
}: DropZoneOptions<T, Intent>) => {
  const appDnd = useAppDndActions();
  const [intent, setIntent] = useState<Intent | null>(null);
  const keyRef = useRef<string | null>(null);
  const validRef = useRef(false);
  const elementRef = useRef<T | null>(null);
  const onClearRef = useRef(onClear);
  // Subscriptions are mounted once per provider; always call the latest onClear.
  onClearRef.current = onClear;

  /** Whether the provider currently counts this zone as the claimed target. */
  const ownsTarget = () => {
    const key = keyRef.current;
    return key !== null && appDnd.getTarget()?.key === key;
  };
  /** Releases the shared claim if it is still ours. */
  const releaseClaim = (key: string | null) => {
    if (key && appDnd.getTarget()?.key === key) appDnd.updateTarget(null);
  };

  /** Wipes local hover state without changing shared state. */
  const clearMarkers = () => {
    if (keyRef.current) onClearRef.current?.();
    keyRef.current = null;
    validRef.current = false;
    elementRef.current?.removeAttribute("data-drop-active");
    elementRef.current = null;
    setIntent(null);
  };
  /** Clears local markers and also releases the shared claim. */
  const clearHover = () => {
    const key = keyRef.current;
    clearMarkers();
    releaseClaim(key);
  };

  // Marker hygiene: wipe on session end or another zone claiming; release on unmount.
  useEffect(() => appDnd.subscribeEnd(clearMarkers), [appDnd]);
  useEffect(
    () =>
      appDnd.subscribeTarget((target) => {
        if (keyRef.current && keyRef.current !== target?.key) clearMarkers();
      }),
    [appDnd],
  );
  useEffect(
    () => () => {
      elementRef.current?.removeAttribute("data-drop-active");
      releaseClaim(keyRef.current);
    },
    [appDnd],
  );

  const targeted = ownsTarget();
  const valid = targeted && validRef.current;
  const marker = targeted ? (valid ? "valid" : "invalid") : undefined;
  const handlers = {
    "data-drop-active": domMarker ? undefined : marker,
    onDragOver: (event: DragEvent<T>) => {
      const entity = appDnd.getActiveEntity();
      // Silent return declines the event: without preventDefault this zone does not claim it.
      if (!entity || !accepts(entity)) return;
      const result = resolve(event, entity);
      if (!result) {
        clearHover();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      // Internal rejection must use an effect the source permits; "none" animates rejection in Chromium.
      // See nativeDropCancellation; external file rejection still uses "none".
      if (result.valid) event.dataTransfer.dropEffect = effect;
      else if (entity.kind !== "external-files") allowNativeDropCancellation(event.dataTransfer);
      else event.dataTransfer.dropEffect = "none";
      // Refs drive marker attributes; render only when the hover key or validity changes.
      const changed = keyRef.current !== result.key || validRef.current !== result.valid;
      keyRef.current = result.key;
      validRef.current = result.valid;
      if (domMarker) {
        elementRef.current = event.currentTarget;
        event.currentTarget.dataset.dropActive = result.valid ? "valid" : "invalid";
      } else if (changed) setIntent(result.operation);
      appDnd.updateTarget({ key: result.key, valid: result.valid, label: result.label });
      onHover?.(event, result.operation, entity);
    },
    onDrop: (event: DragEvent<T>) => {
      const entity = appDnd.getActiveEntity();
      // Silent return declines the event: without preventDefault this zone does not claim it.
      if (!entity || !accepts(entity)) return;
      // Never use the last hover result: React may not have painted at the new pointer.
      const result = resolve(event, entity);
      if (!result) return;
      event.preventDefault();
      event.stopPropagation();
      clearHover();
      if (!result.valid || !appDnd.canCommit(entity.kind)) {
        appDnd.cancel();
        return;
      }
      try {
        const operation = onDrop(event, result.operation, entity);
        appDnd.complete();
        // Async failures belong to the feature; synchronous throws cancel in the catch below.
        void operation;
      } catch (error) {
        appDnd.cancel();
        throw error;
      }
    },
    onDragLeave: (event: DragEvent<T>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && !event.currentTarget.contains(next)) clearHover();
    },
  } as const;

  return { handlers, intent, valid, clearHover };
};
