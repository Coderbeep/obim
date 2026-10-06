import type { AppDragEntity } from "@shared/drag-data";

/** Semantic target state published by a non-React drop handler. */
export type AppDndTargetUpdate = { key: string; valid: boolean; label: string };

/** Lifecycle actions exposed to editor extensions outside React context. */
export interface AppDndBridgeController {
  /** Native adapter guard; permits inactive sessions for delayed Pierre completion unless cancellation is latched. */
  canCommit(kind?: AppDragEntity["kind"]): boolean;
  getActiveEntity(): AppDragEntity | null;
  /** Completes the current drag. */
  complete(): void;
  /** Publishes or clears the current semantic target. */
  updateTarget(update: AppDndTargetUpdate | null): void;
}

let controller: AppDndBridgeController | null = null;

/**
 * Registers the provider actions used by non-React editor extensions.
 *
 * @param next Active provider controller, or `null` during provider cleanup.
 */
export const registerAppDndBridge = (next: AppDndBridgeController | null) => {
  controller = next;
};

/** Provider-backed DnD actions for CodeMirror and other non-React consumers. */
export const appDndBridge = {
  canCommit: (kind?: AppDragEntity["kind"]) => controller?.canCommit(kind) ?? true,
  getActiveEntity: () => controller?.getActiveEntity() ?? null,
  complete: () => controller?.complete(),
  updateTarget: (update: AppDndTargetUpdate | null) => controller?.updateTarget(update),
};
