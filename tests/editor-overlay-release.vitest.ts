import assert from "node:assert/strict";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createStore } from "jotai";
import { afterEach, test } from "vitest";
import MarkdownIt from "markdown-it";
import {
  markdownImagesInText,
  markdownLinksInText,
} from "../src/renderer/src/features/editor/extensions/shared/OverlayMarkdown";
import { createImageExtension } from "../src/renderer/src/features/editor/extensions/ImageExtension";
import { createLinkExtension } from "../src/renderer/src/features/editor/extensions/LinkExtension";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import {
  closeEditorOverlayAtom,
  editorOverlayRequestAtom,
  openEditorOverlayAtom,
  type EditorOverlayPort,
} from "../src/renderer/src/store/editorOverlayStore";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();
const views: EditorView[] = [];
function createView(doc: string) {
  const store = createStore();
  const port: EditorOverlayPort = {
    open: (request) => store.set(openEditorOverlayAtom, request),
    close: (owner) => store.set(closeEditorOverlayAtom, owner),
    hotkey() {},
  };
  const image = createImageExtension({ owner: "images", overlay: port });
  const link = createLinkExtension({
    owner: "links",
    overlay: port,
    openResource() {},
    openExternal() {},
    canonicalizeWikiResource: (path) =>
      path
        .replace(/^01 - Engineering Thesis\//, "")
        .replace(/^Thesis\//, "")
        .replace(/\.(?:md|markdown)(?=#|$)/i, ""),
  });
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc, extensions: [history(), obimMarkdown(), image.extension, link.extension] }),
  });
  views.push(view);
  return { view, store, request: () => store.get(editorOverlayRequestAtom) };
}
function replace(view: EditorView, before: string, after: string) {
  const from = view.state.doc.toString().indexOf(before);
  assert.ok(from >= 0);
  view.dispatch({ selection: { anchor: from, head: from + before.length } });
  view.dispatch({
    changes: { from, to: from + before.length, insert: after },
    selection: { anchor: from + after.length },
    userEvent: "input.type",
  });
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

test("E05 accepting one image completion does not suppress another image destination", () => {
  const { view, request } = createView("![](first.png)\n![](second.png)");
  replace(view, "first.png", "f.png");
  assert.equal(request()?.scope, "images");
  request()?.select("chosen.png");
  assert.equal(request(), null, "acceptance must not immediately reopen suggestions");
  replace(view, "second.png", "chosen.png");
  assert.equal(request()?.source, "chosen.png");
});

test("E05 re-editing an accepted image source and undoing acceptance reopen suggestions", () => {
  const { view, request } = createView("![](first.png)");
  replace(view, "first.png", "f.png");
  request()?.select("chosen.png");
  assert.equal(request(), null);
  undo(view);
  assert.equal(request()?.scope, "images");
  request()?.select("chosen.png");
  replace(view, "chosen.png", "new.png");
  assert.equal(request()?.source, "new.png");
});

test("E05 dismissal stays scoped to the unchanged destination across outside edits", () => {
  const { view, request } = createView("Before\n![](first.png)\n[Note](note.md)");
  replace(view, "first.png", "f.png");
  request()?.close();
  assert.equal(request(), null);
  view.dispatch({ changes: { from: 0, insert: "Earlier " } });
  assert.equal(request(), null);
  replace(view, "note.md", "other.md");
  assert.equal(request()?.scope, "links");
  replace(view, "f.png", "new.png");
  assert.equal(request()?.scope, "images");
  assert.equal(request()?.source, "new.png");
});

test.each(["!", ""])("E06 %s link completion changes only the destination and preserves the exact title", (marker) => {
  const { view, request } = createView(`${marker}[Map](old.png "Keep caption (exact)")`);
  replace(view, "old.png", "o.png");
  assert.equal(request()?.source, "o.png");
  request()?.select("new.png");
  assert.equal(view.state.doc.toString(), `${marker}[Map](new.png "Keep caption (exact)")`);
});

test.each(["!", ""])("E06 %s title edits do not open destination completion", (marker) => {
  const { view, request } = createView(`${marker}[Map](map.png "Caption")`);
  replace(view, "Caption", "Edited title");
  assert.equal(request(), null);
});

test.each(["!", ""])("E06 %s unfinished title edits remain outside destination completion", (marker) => {
  const { view, request } = createView(`${marker}[Map](map.png "Caption`);
  replace(view, "Caption", "Edited title");
  assert.equal(request(), null);
});

test.each(["!", ""])("E06 %s completion preserves angle delimiters, whitespace and a single-quoted title", (marker) => {
  const { view, request } = createView(`${marker}[Map]( <Old map.png>  'Keep title' )`);
  replace(view, "Old map.png", "New map.png");
  assert.equal(request()?.source, "New map.png");
  request()?.select("chosen.png");
  assert.equal(view.state.doc.toString(), `${marker}[Map]( <chosen.png>  'Keep title' )`);
});

test.each(["!", ""])(
  "E06 %s completion accepts a destination while its closing parenthesis is unfinished",
  (marker) => {
    const { view, request } = createView(`${marker}[Map](old.png`);
    replace(view, "old.png", "o.png");
    assert.equal(request()?.source, "o.png");
    request()?.select("new.png");
    assert.equal(view.state.doc.toString(), `${marker}[Map](new.png`);
  },
);

test("E06 empty link destination and first typed image character can be completed", () => {
  const { view, request } = createView("[Note](old.md)\n![]()");
  replace(view, "old.md", "");
  assert.equal(request()?.scope, "links");
  assert.equal(request()?.source, "");
  request()?.select("new.md");
  const cursor = view.state.doc.length - 1;
  view.dispatch({ selection: { anchor: cursor } });
  view.dispatch({ changes: { from: cursor, insert: "a" }, selection: { anchor: cursor + 1 }, userEvent: "input.type" });
  assert.equal(request()?.scope, "images");
  assert.equal(request()?.source, "a");
});

test("E07 selecting an image with spaces produces a Markdown image and leaves suggestions closed", () => {
  const { view, request } = createView('![Map](old.png "Keep title")');
  replace(view, "old.png", "o.png");
  request()?.select("attachments/Project Map.png");
  const images = new MarkdownIt()
    .parseInline(view.state.doc.toString(), {})[0]
    .children?.filter((token) => token.type === "image");
  assert.equal(images?.length, 1);
  assert.equal(request(), null);
  assert.equal(view.state.doc.toString(), '![Map](<attachments/Project Map.png> "Keep title")');
});

test("Obsidian image typing opens image suggestions and completes literal wiki syntax", () => {
  const { view, request } = createView("!");
  view.dispatch({
    changes: { from: 1, insert: "[[" },
    selection: { anchor: 3 },
    userEvent: "input.type",
  });

  assert.equal(request()?.scope, "images");
  assert.equal(request()?.source, "");
  request()?.select("attachments/Project Map.png");

  assert.equal(view.state.doc.toString(), "![[attachments/Project Map.png]]");
  assert.equal(view.state.selection.main.head, "![[attachments/Project Map.png".length);
  assert.equal(request(), null);
});

test("Obsidian image completion preserves an existing size modifier", () => {
  const { view, request } = createView("![[old.png|420]]");
  replace(view, "old.png", "o");

  assert.equal(request()?.scope, "images");
  request()?.select("attachments/New map.png");
  assert.equal(view.state.doc.toString(), "![[attachments/New map.png|420]]");
});

test("wiki note typing opens note suggestions and completes an extensionless target", () => {
  const { view, request } = createView("[");
  view.dispatch({
    changes: { from: 1, insert: "[" },
    selection: { anchor: 2 },
    userEvent: "input.type",
  });

  assert.equal(request()?.scope, "links");
  assert.equal(request()?.source, "");
  request()?.select("01 - Engineering Thesis/Architectures.md");

  assert.equal(view.state.doc.toString(), "[[Architectures]]");
  assert.equal(view.state.selection.main.head, "[[Architectures".length);
  assert.equal(request(), null);
});

test("wiki note completion preserves aliases and heading fragments", () => {
  const { view, request } = createView("[[old|Attention model]]");
  replace(view, "old", "arc");

  assert.equal(request()?.scope, "links");
  request()?.select("Thesis/Architectures.markdown#channel-attention");
  assert.equal(view.state.doc.toString(), "[[Architectures#channel-attention|Attention model]]");
});

test("wiki canonicalization does not alter ordinary Markdown link completion", () => {
  const { view, request } = createView("[Architecture](old.md)");
  replace(view, "old.md", "arc");

  request()?.select("01 - Engineering Thesis/Architectures.md");
  assert.equal(view.state.doc.toString(), "[Architecture](<01 - Engineering Thesis/Architectures.md>)");
});

test.each([
  "nested/Project Map.png",
  "nested/diagram (draft).png",
  "nested/[map].png",
  "nested/100%.png",
  "nested/encoded%20literal.png",
  "nested/Zażółć 🧭.png",
  "nested/amp&copy;.png",
])("E07 image and link completion round-trip without double escaping: %s", (destination) => {
  for (const marker of ["!", ""]) {
    const { view, request } = createView(`${marker}[Map](old.png "Keep title")`);
    replace(view, "old.png", "o.png");
    request()?.select(destination);
    const first = view.state.doc.toString();
    assert.equal(request(), null);
    const info = marker ? markdownImagesInText(first, 0, null)[0] : markdownLinksInText(first, 0, null)[0];
    assert.equal("src" in info ? info.src : info.dest, destination);
    // A fresh editing transaction may replace previously escaped syntax; the
    // next accepted result still comes from the same raw filesystem path.
    const from = "srcFrom" in info ? info.srcFrom : info.destFrom;
    const to = "srcTo" in info ? info.srcTo : info.destTo;
    view.dispatch({ changes: { from, to, insert: "x" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
    request()?.select(destination);
    assert.equal(view.state.doc.toString(), first);
    assert.equal(request(), null);
  }
});
