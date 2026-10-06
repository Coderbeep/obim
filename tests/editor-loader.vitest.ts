import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/features/editor/ObimEditor", () => ({ default: () => null }));
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shares the editor import between warmup and note opening", async () => {
  const { preloadEditor } = await import("../src/renderer/src/features/editor/editorLoader");
  const first = preloadEditor();
  expect(preloadEditor()).toBe(first);
  await first;
  expect(preloadEditor()).toBe(first);
});
it("schedules warmup after a frame and allows cancelling idle work", async () => {
  const idle = vi.fn(() => 7);
  const cancel = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  vi.stubGlobal("cancelIdleCallback", cancel);
  const { scheduleEditorPreload } = await import("../src/renderer/src/features/editor/editorLoader");
  const stop = scheduleEditorPreload();
  expect(idle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20);
  expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2500 });
  stop();
  expect(cancel).toHaveBeenCalledWith(7);
});
it("cancels before the first frame without scheduling work", async () => {
  const idle = vi.fn();
  vi.stubGlobal("requestIdleCallback", idle);
  const { scheduleEditorPreload } = await import("../src/renderer/src/features/editor/editorLoader");
  scheduleEditorPreload()();
  vi.advanceTimersByTime(100);
  expect(idle).not.toHaveBeenCalled();
});

it("renders synchronously on first use after preload without a Suspense fallback", async () => {
  const { createElement, Suspense } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { preloadEditor, LazyObimEditor } = await import("../src/renderer/src/features/editor/editorLoader");
  await preloadEditor();
  const html = renderToString(
    createElement(
      Suspense,
      { fallback: "Opening editor" },
      createElement(LazyObimEditor, {
        fileId: "note",
        filePath: "/notes/note.md",
        paneId: "pane",
        isMarkdown: true,
        openResource: () => {},
      }),
    ),
  );
  expect(html).not.toContain("Opening editor");
  expect(html).not.toContain("template");
});
