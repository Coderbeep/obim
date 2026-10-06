import { afterEach, expect, it, vi } from "vitest";
import { EditorView } from "../src/renderer/src/features/editor/codemirror-view";
import { warmEditor } from "../src/renderer/src/features/editor/warmEditor";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("warms a read-only editor without moving focus and removes it after layout", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  const measure = vi.spyOn(EditorView.prototype, "requestMeasure").mockImplementation(() => {});
  warmEditor();
  const editor = document.querySelector<HTMLElement>(".cm-editor")!;
  expect(editor).toBeTruthy();
  const view = EditorView.findFromDOM(editor)!;
  expect(view.state.readOnly).toBe(true);
  expect(view.contentDOM.getAttribute("contenteditable")).toBe("false");
  expect(document.activeElement).toBe(input);
  expect(editor.closest('[aria-hidden="true"]')).toBeTruthy();
  const complete = measure.mock.calls.at(-1)?.[0];
  expect(complete).toBeTruthy();
  complete!.read(view);
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector(".cm-editor")).toBeNull();
  warmEditor();
  expect(document.querySelector(".cm-editor")).toBeNull();
  input.remove();
});
