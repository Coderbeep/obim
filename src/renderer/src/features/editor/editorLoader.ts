import { createElement, lazy } from "react";
import type { ObimEditorProps } from "./ObimEditor";

let readyEditor: typeof import("./ObimEditor").default | undefined;
let editorModule: Promise<typeof import("./ObimEditor")> | undefined;

/** Share the first editor import between idle warmup and every note surface. */
export function preloadEditor() {
  editorModule ??= import("./ObimEditor")
    .then((module) => {
      readyEditor = module.default;
      return module;
    })
    .catch((error) => {
      editorModule = undefined;
      throw error;
    });
  return editorModule;
}

const PendingEditor = lazy(preloadEditor);

/** A completed preload must render synchronously, without a first-use Suspense fallback. */
export function LazyObimEditor(props: ObimEditorProps) {
  return createElement(readyEditor ?? PendingEditor, props);
}

/** Wait until the initial interface has painted, then warm the editor in idle time. */
export function scheduleEditorPreload() {
  let idle: number | undefined;
  let timer: number | undefined;
  let cancelled = false;
  const warm = () => {
    void Promise.all([preloadEditor(), import("./warmEditor")])
      .then(([, module]) => {
        if (!cancelled) module.warmEditor();
      })
      .catch(() => {
        /* Opening a note can retry a failed warmup. */
      });
  };
  const frame = window.requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(warm, { timeout: 2500 });
    } else {
      timer = window.setTimeout(warm, 250);
    }
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
