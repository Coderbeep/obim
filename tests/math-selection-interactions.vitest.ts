import assert from "node:assert/strict";

import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, test, vi } from "vitest";

import { createEditorSelectionExtensions } from "../src/renderer/src/features/editor/editorSelection";
import { setFrontmatterSourceEditingEffect } from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { MathBlockExtension } from "../src/renderer/src/features/editor/extensions/MathExpression";
import { createNoteHeaderExtension } from "../src/renderer/src/features/editor/extensions/NoteHeaderExtension";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { createEditorExtensions } from "../src/renderer/src/features/editor/setup";
import type { EditorOverlayPort } from "../src/renderer/src/store/editorOverlayStore";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];
const overlay: EditorOverlayPort = { open() {}, close() {}, hotkey() {} };

beforeEach(() => {
  vi.stubGlobal("api", {
    doesFileExist: vi.fn(async () => true),
    focusAppWindow: vi.fn(),
    listWorkspaceFrontmatterFields: vi.fn(async () => []),
    openFile: vi.fn(async () => "{}"),
    queryWorkspaceProperty: vi.fn(async () => []),
    upsertFile: vi.fn(async () => true),
  });
});

function createView(doc: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [obimMarkdown(), MathBlockExtension, createEditorSelectionExtensions(() => {})],
    }),
  });
  views.push(view);
  return view;
}

function createFullEditorView(doc: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        createEditorExtensions({
          isMarkdown: true,
          owner: "select-all-regression",
          overlay,
          notify() {},
          openResource() {},
          openExternal() {},
          noteHeader: createNoteHeaderExtension("Selection regression", async () => true),
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

const waitForEditorFrames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function nativeSelectionPositions(view: EditorView) {
  const selection = view.contentDOM.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;

  return {
    anchor: view.posAtDOM(selection.anchorNode, selection.anchorOffset),
    head: view.posAtDOM(selection.focusNode, selection.focusOffset),
  };
}

function copySelectedText(view: EditorView) {
  const copied = new Map<string, string>();
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      clearData: () => copied.clear(),
      setData: (type: string, value: string) => copied.set(type, value),
    },
  });
  view.contentDOM.dispatchEvent(event);
  return copied.get("text/plain");
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

test("Control+A selects a document containing inline and block math", async () => {
  const doc = `The forward process is a Markov chain, so at step $i$ the new state depends only on the immediately previous state $i-1$.

The forward chain is multi-step conceptually, but it can be sampled in one operation during training.

The $\\alpha_i = \\sqrt{1 - \\beta_i^2}$ is used as the multiplication factor, because otherwise the variance would grow at every step:
$$
x_i = x_{i-1} + \\beta_i\\epsilon_i
$$
so the $\\alpha_i$ is reducing that effect. The coefficients satisfy $\\alpha_i^2 + \\beta_i^2 = 1$.
Another way to explain is that multiplying random variable by some value makes the coefficient grow with square`;
  const view = createView(doc);
  assert.ok(view.dom.querySelector(".cm-math-widget"));

  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "a" });
  view.contentDOM.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(
    { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
    { anchor: 0, head: doc.length },
  );
  assert.equal(view.dom.querySelector(".cm-math-widget-inline"), null);

  await waitForEditorFrames();
  assert.deepEqual(
    { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
    { anchor: 0, head: doc.length },
  );
});

test("pointer selection reveals inline math only after mouseup in either direction", async () => {
  const doc = "before $x_{coverage}$ after";
  const view = createView(doc);

  for (const selection of [
    { anchor: 0, head: doc.length },
    { anchor: doc.length, head: 0 },
  ]) {
    view.dispatch({ selection: { anchor: selection.anchor } });
    const widget = view.dom.querySelector(".cm-math-widget-inline");
    assert.ok(widget);

    view.dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
    view.dispatch({ selection, userEvent: "select.pointer" });

    assert.equal(view.dom.querySelector(".cm-math-widget-inline"), widget);
    assert.deepEqual({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }, selection);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    assert.equal(view.dom.querySelector(".cm-math-widget-inline"), widget);

    await waitForEditorFrames();
    assert.equal(view.dom.querySelector(".cm-math-widget-inline"), null);
    assert.deepEqual({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }, selection);
  }
});

test("pointer selection reveals block math only after mouseup in either direction", async () => {
  const doc = "before\n\n$$\nx_{coverage}\n$$\n\nafter";
  const view = createView(doc);

  for (const selection of [
    { anchor: 0, head: doc.length },
    { anchor: doc.length, head: 0 },
  ]) {
    view.dispatch({ selection: { anchor: selection.anchor } });
    const widget = view.dom.querySelector(".cm-math-widget-block:not(.cm-math-widget-live-preview)");
    assert.ok(widget);

    view.dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
    view.dispatch({ selection, userEvent: "select.pointer" });

    assert.equal(view.dom.querySelector(".cm-math-widget-block:not(.cm-math-widget-live-preview)"), widget);
    assert.deepEqual({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }, selection);

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    assert.equal(view.dom.querySelector(".cm-math-widget-block:not(.cm-math-widget-live-preview)"), widget);

    await waitForEditorFrames();
    assert.equal(view.dom.querySelector(".cm-math-widget-block:not(.cm-math-widget-live-preview)"), null);
    assert.ok(view.dom.querySelector(".cm-math-widget-live-preview"));
    assert.deepEqual({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }, selection);
  }
});

test("Control+A selects and replaces only the visible production editor body with frontmatter and math", async () => {
  const doc = String.raw`---
cssclasses:
- justify
---

The forward process is a Markov chain, so at step $i$ the new state depends only on the immediately previous state $i-1$.

The forward chain is multi-step conceptually, but it can be sampled in one operation during training.

The $\alpha\_i  = \sqrt{1 - \beta\_i^2}$ is used as the multiplication factor, because otherwise the variance would grow at every step:
$$
x\_i = x\_{i-1} + \beta\_i\epsilon\_i
$$
so the $\alpha\_i$ is reducing that effect. The coefficients satisfy the $\alpha\_i^2 + \beta\_i^2 = 1$ (one way to explain this is that thanks to this the lay on unit circle, so the operations only redistibute the budget between them).
Another way to explain is that multiplying random variable by some value makes the coefficient grow with square.`;
  const view = createFullEditorView(doc);
  const frontmatter = "---\ncssclasses:\n- justify\n---\n";
  assert.ok(doc.startsWith(frontmatter));
  const bodyFrom = frontmatter.length;
  const firstVisibleBodyPosition = doc.indexOf("The forward process");
  const cursorPositions = [doc.indexOf("forward process"), doc.indexOf("otherwise"), doc.indexOf("so the"), doc.length];

  await waitForEditorFrames();
  assert.ok(view.dom.querySelector(".cm-note-header"));
  assert.ok(view.dom.querySelector(".cm-math-widget-inline"));
  assert.ok(view.dom.querySelector(".cm-math-widget-block"));

  for (const cursor of cursorPositions) {
    view.dispatch({ selection: { anchor: cursor } });
    view.focus();

    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "a" });
    view.contentDOM.dispatchEvent(event);

    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(
      { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
      { anchor: bodyFrom, head: doc.length },
    );

    await waitForEditorFrames();
    assert.deepEqual(
      { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
      { anchor: bodyFrom, head: doc.length },
    );
    assert.deepEqual(nativeSelectionPositions(view), { anchor: firstVisibleBodyPosition, head: doc.length });
    assert.equal(
      view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
      doc.slice(bodyFrom),
    );
    assert.equal(copySelectedText(view), doc.slice(bodyFrom));

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(
      { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
      { anchor: bodyFrom, head: doc.length },
    );
  }

  view.dispatch(view.state.replaceSelection("Replacement body"), { userEvent: "input.paste" });
  assert.equal(view.state.doc.toString(), frontmatter + "Replacement body");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), doc);
  assert.equal(redo(view), true);
  assert.equal(view.state.doc.toString(), frontmatter + "Replacement body");
});

test("Control+A in explicit source mode includes frontmatter in the production editor", async () => {
  const doc = "---\ncount: 12\n---\nBody $x$";
  const view = createFullEditorView(doc);
  view.dispatch({ effects: setFrontmatterSourceEditingEffect.of(true) });
  view.focus();
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true, key: "a" });
  view.contentDOM.dispatchEvent(event);
  await waitForEditorFrames();

  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(
    { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
    { anchor: 0, head: doc.length },
  );
  assert.equal(copySelectedText(view), doc);
  view.dispatch(view.state.replaceSelection("Source replacement"), { userEvent: "input.paste" });
  assert.equal(view.state.doc.toString(), "Source replacement");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), doc);
});
