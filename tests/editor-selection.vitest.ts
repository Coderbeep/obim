import assert from "node:assert/strict";

import { defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, test, vi } from "vitest";

import { createEditorSelectionExtensions } from "../src/renderer/src/features/editor/editorSelection";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];

function createView(doc = "first\nsecond") {
  const parent = document.body.appendChild(document.createElement("div"));
  const focusWindow = vi.fn();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [keymap.of(defaultKeymap), createEditorSelectionExtensions(focusWindow)],
    }),
  });
  views.push(view);
  return { focusWindow, view };
}

afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

test("Control+A selects the complete editor document", () => {
  const { view } = createView();
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "a",
  });

  view.contentDOM.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(view.state.selection.main.from, 0);
  assert.equal(view.state.selection.main.to, view.state.doc.length);
});

test("returning to the window during a mouse selection restores editor focus", () => {
  const { focusWindow, view } = createView();
  const focusEditor = vi.spyOn(view, "focus");
  vi.spyOn(document, "hasFocus").mockReturnValue(false);

  view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));

  assert.equal(focusWindow.mock.calls.length, 1);
  assert.equal(focusEditor.mock.calls.length, 1);

  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));
  assert.equal(focusWindow.mock.calls.length, 1);
});

test("a released mouse button cancels stale selection focus recovery", () => {
  const { focusWindow, view } = createView();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);

  view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 0 }));
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, buttons: 1 }));

  assert.equal(focusWindow.mock.calls.length, 0);
});
