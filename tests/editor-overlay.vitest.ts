import assert from "node:assert/strict";

import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { createStore } from "jotai";
import { afterEach, test } from "vitest";

import { createEditorOverlayController } from "../src/renderer/src/features/editor/extensions/shared/EditorOverlay";
import {
  closeEditorOverlayAtom,
  editorOverlayRequestAtom,
  openEditorOverlayAtom,
  routeEditorOverlayHotkeyAtom,
  type EditorOverlayPort,
} from "../src/renderer/src/store/editorOverlayStore";

Range.prototype.getClientRects ??= () => [new DOMRect(20, 30, 1, 14)] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect(20, 30, 1, 14);

const views: EditorView[] = [];

const createView = (doc: string, extension: NonNullable<Parameters<typeof EditorState.create>[0]>["extensions"]) => {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: extension }) });
  views.push(view);
  return view;
};

const createPort = (store: ReturnType<typeof createStore>): EditorOverlayPort => ({
  open: (request) => store.set(openEditorOverlayAtom, request),
  close: (owner) => store.set(closeEditorOverlayAtom, owner),
  hotkey: (owner, key) => store.set(routeEditorOverlayHotkeyAtom, { owner, key }),
});

afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

test("competing editor owners keep one request and selection updates only its originating editor", () => {
  const store = createStore();
  const port = createPort(store);
  const first = createEditorOverlayController({ owner: "first", scope: "links", port, allowEmptySource: true });
  const second = createEditorOverlayController({ owner: "second", scope: "images", port });
  const firstView = createView("[Note](old.md)", first.extension);
  const secondView = createView("![Alt](old.png)", second.extension);

  first.open(firstView, { activePos: [7, 13], anchorPos: 7, src: "old.md" }, 7);
  assert.equal(store.get(editorOverlayRequestAtom)?.owner, "first");

  second.open(secondView, { activePos: [7, 14], anchorPos: 7, src: "old.png" }, 7);
  assert.equal(first.isOpen(), false);
  assert.equal(second.isOpen(secondView), true);
  assert.equal(store.get(editorOverlayRequestAtom)?.owner, "second");

  first.close();
  port.hotkey("first", "ArrowDown");
  assert.equal(store.get(editorOverlayRequestAtom)?.hotkey, null);

  port.hotkey("second", "ArrowDown");
  assert.deepEqual(store.get(editorOverlayRequestAtom)?.hotkey, { key: "ArrowDown", revision: 1 });
  store.get(editorOverlayRequestAtom)?.select("new.png");

  assert.equal(firstView.state.doc.toString(), "[Note](old.md)");
  assert.equal(secondView.state.doc.toString(), "![Alt](new.png)");
  assert.equal(store.get(editorOverlayRequestAtom), null);
});

test("destroying the active editor clears its request without closing a newer owner", () => {
  const store = createStore();
  const port = createPort(store);
  const stale = createEditorOverlayController({ owner: "stale", scope: "links", port, allowEmptySource: true });
  const active = createEditorOverlayController({ owner: "active", scope: "links", port, allowEmptySource: true });
  const staleView = createView("[A](a.md)", stale.extension);
  const activeView = createView("[B](b.md)", active.extension);

  stale.open(staleView, { activePos: [4, 8], anchorPos: 4, src: "a.md" }, 4);
  active.open(activeView, { activePos: [4, 8], anchorPos: 4, src: "b.md" }, 4);
  staleView.destroy();
  views.splice(views.indexOf(staleView), 1);
  assert.equal(store.get(editorOverlayRequestAtom)?.owner, "active");

  activeView.destroy();
  views.splice(views.indexOf(activeView), 1);
  assert.equal(store.get(editorOverlayRequestAtom), null);
});

test("an empty image source does not open a keyboard-active request", () => {
  const store = createStore();
  const controller = createEditorOverlayController({ owner: "image", scope: "images", port: createPort(store) });
  const view = createView("![]()", controller.extension);

  controller.open(view, { activePos: [4, 4], anchorPos: 4, src: "" }, 4);

  assert.equal(controller.isOpen(), false);
  assert.equal(store.get(editorOverlayRequestAtom), null);
});

test("an inactive overlay rejects stale selections, unavailable anchors, and keyboard input", () => {
  const store = createStore();
  const controller = createEditorOverlayController({
    owner: "link",
    scope: "links",
    port: createPort(store),
    allowEmptySource: true,
  });
  const view = createView("[Note]()", controller.extension);

  controller.open(view, { activePos: [7, 7], anchorPos: 7, src: "" }, 7);
  const request = store.get(editorOverlayRequestAtom);
  assert.ok(request);
  assert.equal(request.source, "");

  const bindings = view.state.facet(keymap).flat();
  for (const key of ["ArrowUp", "ArrowDown", "Enter"]) {
    const binding = bindings.find((candidate) => candidate.key === key);
    assert.ok(binding?.run);
    assert.equal(binding.run(view), true);
  }
  assert.deepEqual(store.get(editorOverlayRequestAtom)?.hotkey, { key: "Enter", revision: 3 });

  const escape = bindings.find((candidate) => candidate.key === "Escape");
  assert.ok(escape?.run);
  assert.equal(escape.run(view), true);
  request.select("ignored.md");
  assert.equal(view.state.doc.toString(), "[Note]()");

  controller.open(
    { coordsAtPos: () => null } as unknown as EditorView,
    { activePos: [0, 0], anchorPos: 0, src: "missing.md" },
    0,
  );
  assert.equal(store.get(editorOverlayRequestAtom), null);

  for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape"]) {
    const binding = bindings.find((candidate) => candidate.key === key);
    assert.ok(binding?.run);
    assert.equal(binding.run(view), false);
  }
});

test("typing a section after choosing a note reopens link suggestions", () => {
  const store = createStore();
  const controller = createEditorOverlayController({
    owner: "link",
    scope: "links",
    port: createPort(store),
    allowEmptySource: true,
  });
  const view = createView("[Note]()", controller.extension);
  controller.open(view, { activePos: [7, 7], anchorPos: 7, src: "" }, 7);
  store.get(editorOverlayRequestAtom)?.select("note.md");
  controller.open(view, { activePos: [7, 14], anchorPos: 7, src: "note.md" }, 14);
  assert.equal(controller.isOpen(), false);
  view.dispatch({ changes: { from: 14, insert: "#" } });
  controller.open(view, { activePos: [7, 15], anchorPos: 7, src: "note.md#" }, 15);
  assert.equal(store.get(editorOverlayRequestAtom)?.source, "note.md#");
});

test("inserts readable filenames with Markdown angle delimiters and avoids double wrapping", () => {
  const store = createStore();
  const controller = createEditorOverlayController({
    owner: "link",
    scope: "links",
    port: createPort(store),
    allowEmptySource: true,
  });
  const view = createView("[Note]()", controller.extension);
  controller.open(view, { activePos: [7, 7], anchorPos: 7, src: "" }, 7);
  store.get(editorOverlayRequestAtom)?.select("Thesis - #1.md");
  assert.equal(view.state.doc.toString(), "[Note](<Thesis - #1.md>)");
  assert.equal(view.state.doc.sliceString(view.state.selection.main.head, view.state.selection.main.head + 1), ">");
  controller.close();
  const nextController = createEditorOverlayController({ owner: "link-next", scope: "links", port: createPort(store) });
  nextController.open(view, { activePos: [8, 22], anchorPos: 8, src: "Thesis - #1.md" }, 8);
  store.get(editorOverlayRequestAtom)?.select("Another note.md");
  assert.equal(view.state.doc.toString(), "[Note](<Another note.md>)");
});
