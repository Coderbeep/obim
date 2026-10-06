import assert from "node:assert/strict";

import { history, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { codeFolding, foldedRanges } from "@codemirror/language";
import { openSearchPanel, SearchQuery } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type PluginValue, type ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { afterEach, test, vi } from "vitest";

const { hasClipboardImageFiles, importClipboardImages, saveBinaryFile } = vi.hoisted(() => ({
  hasClipboardImageFiles: vi.fn(() => false),
  importClipboardImages: vi.fn(),
  saveBinaryFile: vi.fn(),
}));

vi.mock("@renderer/features/files/workspaceFileService", () => ({
  hasClipboardImageFiles,
  importClipboardImages,
  saveBinaryFile,
}));

import { CodeBlockExtension } from "../src/renderer/src/features/editor/extensions/CodeBlockExtension";
import { BlockQuoteExtension } from "../src/renderer/src/features/editor/extensions/BlockQuoteExtension";
import { editorOverlayAnchor } from "../src/renderer/src/features/editor/extensions/shared/EditorOverlay";
import { HorizontalRuleExtension } from "../src/renderer/src/features/editor/extensions/HorizontalRuleExtension";
import { HeadingExtension } from "../src/renderer/src/features/editor/extensions/HeadingExtension";
import {
  buildImageDecorations,
  createImageExtension,
} from "../src/renderer/src/features/editor/extensions/ImageExtension";
import { createLinkExtension } from "../src/renderer/src/features/editor/extensions/LinkExtension";
import { createListsExtension } from "../src/renderer/src/features/editor/extensions/ListsExtension";
import {
  buildMathDecorations,
  MathBlockExtension,
} from "../src/renderer/src/features/editor/extensions/MathExpression";
import { createBufferedViewport } from "../src/renderer/src/features/editor/extensions/shared/bufferedViewport";
import { createPasteExtension } from "../src/renderer/src/features/editor/extensions/PasteExtension";
import { queryMatchesTable, tableExtensions } from "../src/renderer/src/features/editor/extensions/TableExtension";
import { fileDropExtension } from "../src/renderer/src/features/editor/editorInput";
import { registerAppDndBridge } from "../src/renderer/src/shared/dnd/bridge";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { createEditorExtensions, resetEditorHistory } from "../src/renderer/src/features/editor/setup";
import { basicLight } from "../src/renderer/src/features/editor/styles/basic-light";
import type { EditorOverlayPort, EditorOverlayRequest } from "../src/renderer/src/store/editorOverlayStore";
import { FILE_DRAG_DATA_MIME } from "../src/shared/drag-data";
import type { FileItem } from "../src/shared/file-item";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];
let overlayRequest: EditorOverlayRequest | null = null;
const overlayHotkeys: string[] = [];
const overlayPort: EditorOverlayPort = {
  open: (request) => {
    overlayRequest = request;
  },
  close: (owner) => {
    if (overlayRequest?.owner === owner) overlayRequest = null;
  },
  hotkey: (owner, key) => {
    if (overlayRequest?.owner === owner) overlayHotkeys.push(`${overlayRequest.scope}:${key}`);
  },
};
const imageSetup = createImageExtension({ owner: "image-test", overlay: overlayPort });
const linkSetup = createLinkExtension({
  owner: "link-test",
  overlay: overlayPort,
  openResource() {},
  openExternal() {},
});
const ImageExtension = imageSetup.extension;
const LinkExtension = linkSetup.extension;
const ListsExtension = createListsExtension(() => imageSetup.controller.isOpen() || linkSetup.controller.isOpen());
const notify = vi.fn();
const onFilesCreated = vi.fn();
const PasteExtension = createPasteExtension(notify, onFilesCreated);

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

function createView(doc: string, extension: Extension, selection = 0) {
  return createRawView(doc, [obimMarkdown(), extension], selection);
}

function createRawView(doc: string, extensions: Extension, selection = 0) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions,
    }),
  });
  views.push(view);
  return view;
}

function mathWidgetFromDocument(doc: string, widgetName: string) {
  const state = EditorState.create({ doc, extensions: [obimMarkdown()] });
  let widget: { updateDOM(dom: HTMLElement): boolean } | null = null;

  buildMathDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
    const candidate = value.spec.widget as unknown as {
      constructor: { name: string };
      updateDOM(dom: HTMLElement): boolean;
    };
    if (candidate?.constructor.name === widgetName) widget = candidate;
  });

  assert.ok(widget);
  return widget as { updateDOM(dom: HTMLElement): boolean };
}

function mathDecorationSource(view: EditorView) {
  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === "function" ? source(view) : source;
    let found = false;
    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      const widgetName = decoration.spec.widget?.constructor.name ?? "";
      const className = typeof decoration.spec.class === "string" ? decoration.spec.class : "";
      if (widgetName.startsWith("Math") || className.split(/\s+/).includes("cm-formatting-math-mark")) found = true;
    });
    if (found) return decorations;
  }
  assert.fail("Expected math decorations");
}

test("resetting editor history keeps the document but removes undo and redo entries", () => {
  const historyCompartment = new Compartment();
  const view = createRawView("first", historyCompartment.of(history()));

  view.dispatch({ changes: { from: view.state.doc.length, insert: " edit" }, userEvent: "input.type" });
  assert.equal(undoDepth(view.state), 1);

  resetEditorHistory(view, historyCompartment);

  assert.equal(view.state.doc.toString(), "first edit");
  assert.equal(undoDepth(view.state), 0);
  assert.equal(undo(view), false);

  view.dispatch({ changes: { from: view.state.doc.length, insert: " again" }, userEvent: "input.type" });
  assert.equal(undo(view), true);
  assert.equal(redoDepth(view.state), 1);

  resetEditorHistory(view, historyCompartment);

  assert.equal(view.state.doc.toString(), "first edit");
  assert.equal(redoDepth(view.state), 0);
  assert.equal(redo(view), false);
});

function pasteEvent(data: Partial<DataTransfer>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  return event;
}

function imageClipboardData(file: File) {
  return {
    items: [
      {
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      },
    ],
    files: [],
    getData: () => "",
  } as unknown as DataTransfer;
}

function fileDropEvent(file: FileItem) {
  const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types: [FILE_DRAG_DATA_MIME],
      getData: (type: string) => (type === FILE_DRAG_DATA_MIME ? JSON.stringify(file) : ""),
    },
  });
  return event;
}

function nativeFileEvent(type: "dragover" | "drop", files: File[]) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
  const dataTransfer = {
    dropEffect: "none",
    files,
    items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    types: ["Files"],
  };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return { dataTransfer, event };
}

afterEach(() => {
  registerAppDndBridge(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  overlayRequest = null;
  overlayHotkeys.length = 0;
  hasClipboardImageFiles.mockReset().mockReturnValue(false);
  importClipboardImages.mockReset();
  notify.mockClear();
  onFilesCreated.mockClear();
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

test("heading disclosure toggles fold the complete Markdown section", () => {
  const doc = "# First\nintro\n## Nested\nnested content\n# Second\nsecond content";
  const view = createRawView(doc, [obimMarkdown(), codeFolding(), HeadingExtension], doc.length);
  const toggle = view.dom.querySelector<HTMLButtonElement>(".cm-heading-fold-toggle");

  assert.ok(toggle);
  assert.equal(toggle.textContent, "H1");
  assert.equal(toggle.dataset.level, "1");
  assert.ok(toggle.querySelector(".cm-heading-level-indicator"));
  assert.equal(toggle.dataset.folded, "false");
  toggle.click();

  const folded: Array<{ from: number; to: number }> = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    folded.push({ from, to });
  });
  assert.equal(folded.length, 1);
  assert.equal(view.dom.querySelector<HTMLButtonElement>(".cm-heading-fold-toggle")?.dataset.folded, "true");

  view.dom.querySelector<HTMLButtonElement>(".cm-heading-fold-toggle")?.click();
  folded.length = 0;
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    folded.push({ from, to });
  });
  assert.equal(folded.length, 0);
});

test("a standalone dash is not exposed as an H2 folding control", () => {
  const view = createRawView("Source paragraph\n-\nfollowing content", [
    obimMarkdown(),
    codeFolding(),
    HeadingExtension,
  ]);

  assert.equal(view.dom.querySelector(".cm-heading-fold-toggle"), null);
});

test("callouts render a semantic label and reveal their Markdown marker for editing", () => {
  const doc = "\n> [!info]\n> Useful context";
  const view = createView(doc, BlockQuoteExtension);
  const label = view.dom.querySelector<HTMLElement>(".cm-callout-label-info");

  assert.ok(label);
  assert.equal(label.textContent, "INFO");
  assert.equal(view.dom.querySelectorAll(".cm-callout-line.cm-callout-info").length, 2);

  label.click();

  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "[!info]");
  assert.equal(view.dom.querySelector(".cm-callout-label"), null);
  assert.ok(view.dom.querySelector(".cm-formatting-callout.cm-active"));
});

test("task checkbox widgets toggle source and stop pointer events from reaching the editor", () => {
  const doc = "\n- [ ] task";
  const view = createView(doc, ListsExtension);
  const checkbox = view.dom.querySelector<HTMLInputElement>(".cm-task-list-checkbox");

  assert.ok(checkbox);
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.disabled, false);
  assert.equal(checkbox.dataset.task, " ");
  const shell = checkbox.closest<HTMLElement>(".cm-task-list-checkbox-shell");
  assert.ok(shell);
  assert.equal(shell.dataset.transition, undefined);
  assert.ok(checkbox.nextElementSibling?.matches(".cm-task-list-checkbox-visual"));
  assert.ok(checkbox.nextElementSibling?.querySelector(".cm-task-list-checkbox-check path"));

  let bubbled = 0;
  view.dom.addEventListener("mousedown", () => (bubbled += 1));
  shell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  assert.equal(bubbled, 0);

  shell.click();
  assert.equal(view.state.doc.toString(), "\n- [x] task");
  assert.equal(shell.dataset.transition, "checking");
  assert.ok(view.dom.querySelector(".cm-task-list-content-checked.cm-task-list-content-checking"));
});

test("checked task checkbox widgets can mark a task incomplete", () => {
  const view = createView("\n- [x] task", ListsExtension);
  const checkbox = view.dom.querySelector<HTMLInputElement>(".cm-task-list-checkbox");

  assert.ok(checkbox);
  const shell = checkbox.closest<HTMLElement>(".cm-task-list-checkbox-shell");
  assert.ok(shell);
  checkbox.click();
  assert.equal(view.state.doc.toString(), "\n- [ ] task");
  assert.equal(shell.dataset.transition, "unchecking");
  assert.equal(checkbox.isConnected, true);
  shell.dispatchEvent(new MouseEvent("mouseleave"));
  assert.equal(shell.dataset.transition, undefined);
});

test("task checkbox widgets keep toggling on repeated clicks without revealing their syntax", () => {
  const view = createView("\n- [ ] repeat", ListsExtension);
  const shell = view.dom.querySelector<HTMLElement>(".cm-task-list-checkbox-shell");

  assert.ok(shell);
  shell.click();
  assert.equal(view.state.doc.toString(), "\n- [x] repeat");
  shell.click();
  assert.equal(view.state.doc.toString(), "\n- [ ] repeat");
  shell.click();
  assert.equal(view.state.doc.toString(), "\n- [x] repeat");
  assert.equal(view.dom.querySelector(".cm-formatting-task-marker"), null);
  assert.equal(shell.isConnected, true);
});

test("list marker widgets preserve their DOM when source positions shift", () => {
  const view = createView("\n- bullet\n- [ ] task", ListsExtension);
  const bullet = view.dom.querySelector<HTMLElement>(".cm-list-bullet");
  const task = view.dom.querySelector<HTMLElement>(".cm-task-list-checkbox-shell");

  assert.ok(bullet);
  assert.ok(task);
  view.dispatch({ changes: { from: 0, insert: "prefix\n" } });

  assert.equal(view.dom.querySelector(".cm-list-bullet"), bullet);
  assert.equal(view.dom.querySelector(".cm-task-list-checkbox-shell"), task);
  task.click();
  assert.equal(view.state.doc.toString(), "prefix\n\n- bullet\n- [x] task");
});

test("horizontal rule widgets reveal their source when clicked", () => {
  const doc = "\n---   ";
  const view = createView(doc, HorizontalRuleExtension);
  const widget = view.dom.querySelector<HTMLElement>(".cm-horizontal-rule-widget-container");

  assert.ok(widget);
  widget.click();

  assert.equal(view.state.selection.main.head, doc.indexOf("---") + 3);
  assert.equal(view.dom.querySelector(".cm-horizontal-rule-widget-container"), null);
});

test("link widgets forward internal destinations and normalize external URLs through injected callbacks", () => {
  const openResource = vi.fn();
  const openExternal = vi.fn();
  const extension = createLinkExtension({
    owner: "link-callback-test",
    overlay: overlayPort,
    openResource,
    openExternal,
  }).extension;
  const view = createView(
    "\n[Note](folder/note.md) and [Site](www.example.com) and [](folder/Untitled.md) and [Docs](https://docs.example.com) and [](folder/)",
    extension,
  );
  const links = view.dom.querySelectorAll<HTMLElement>(".cm-link-placeholder");

  assert.equal(links.length, 5);
  assert.equal(links[0].tagName, "A");
  assert.equal(links[0].getAttribute("href"), "folder/note.md");
  assert.equal(links[1].getAttribute("href"), "https://www.example.com");
  assert.equal(links[2].textContent, "Untitled.md");
  assert.equal(links[4].textContent, "folder/");
  const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  links[0].dispatchEvent(mouseDown);
  assert.equal(mouseDown.defaultPrevented, true);
  links[0].click();
  links[1].click();
  links[3].click();

  assert.deepEqual(openResource.mock.calls, [["folder/note.md"]]);
  assert.deepEqual(openExternal.mock.calls, [["https://www.example.com"], ["https://docs.example.com"]]);

  const firstLink = links[0];
  view.dispatch({ changes: { from: view.state.doc.length, insert: " trailing text" } });
  assert.equal(view.dom.querySelector(".cm-link-placeholder"), firstLink);
  view.dispatch({});
});

test("hovering a Markdown PDF selection link reports its destination and clears on leave", () => {
  const onHoverPdfReference = vi.fn();
  const extension = createLinkExtension({
    owner: "pdf-hover-test",
    overlay: overlayPort,
    openResource() {},
    openExternal() {},
    onHoverPdfReference,
  }).extension;
  const destination = "Principles.pdf#page=1&selection=0,4,0,21";
  const view = createView(`\n[First](${destination}) and [Other](note.md)`, extension);
  const links = view.dom.querySelectorAll<HTMLElement>(".cm-link-placeholder");
  links[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  links[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  assert.deepEqual(onHoverPdfReference.mock.calls, [[destination]]);
  links[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  assert.deepEqual(onHoverPdfReference.mock.calls, [[destination], [null]]);
  links[0].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  view.dom.dispatchEvent(new MouseEvent("mouseleave"));
  assert.deepEqual(onHoverPdfReference.mock.calls.at(-1), [null]);
});

test("hovering an active Markdown PDF link still reports its selection", () => {
  const onHoverPdfReference = vi.fn();
  const destination = "Principles.pdf#page=1&selection=0,4,0,21";
  const doc = `[First](${destination})`;
  const view = createView(
    doc,
    createLinkExtension({
      owner: "active-pdf-hover-test",
      overlay: overlayPort,
      openResource() {},
      openExternal() {},
      onHoverPdfReference,
    }).extension,
    doc.indexOf("First") + 1,
  );
  const text = view.dom.querySelector<HTMLElement>(".cm-formatting-link-text");
  assert.ok(text);
  vi.spyOn(view, "posAtCoords").mockReturnValue(doc.indexOf("First") + 1);
  text.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  assert.deepEqual(onHoverPdfReference.mock.calls, [[destination]]);
  view.dispatch({ changes: { from: doc.length, insert: " more" } });
  assert.deepEqual(onHoverPdfReference.mock.calls.at(-1), [null]);
});

test("wiki note widgets display aliases, use their dedicated resolver callback, and stay inert inside code", () => {
  const openResource = vi.fn();
  const openWikiResource = vi.fn();
  const extension = createLinkExtension({
    owner: "wiki-link-callback-test",
    overlay: overlayPort,
    openResource,
    openWikiResource,
    openExternal() {},
  }).extension;
  const view = createView(
    "\n[[Architectures]] and [[Third Semester/RCAN|Channel attention]] and `[[Inline code]]`\n```\n[[Fenced code]]\n```",
    extension,
  );
  const links = view.dom.querySelectorAll<HTMLElement>(".cm-link-placeholder");

  assert.equal(links.length, 2);
  assert.equal(links[0].textContent, "Architectures");
  assert.equal(links[1].textContent, "Channel attention");
  links[0].click();
  links[1].click();
  assert.deepEqual(openWikiResource.mock.calls, [["Architectures"], ["Third Semester/RCAN"]]);
  assert.equal(openResource.mock.calls.length, 0);
});

test("active wiki note syntax styles delimiters, target, and alias separately", () => {
  const doc = "[[Architectures|Architecture notes]]";
  const view = createView(doc, LinkExtension, doc.indexOf("Architectures") + 3);

  assert.ok(view.dom.querySelector(".cm-formatting-link-mark"));
  assert.equal(view.dom.querySelector(".cm-formatting-link-target")?.textContent, "Architectures");
  assert.equal(view.dom.querySelector(".cm-formatting-link-text")?.textContent, "Architecture notes");
});

test("editing image and link targets drives their shared overlay keymap lifecycle", () => {
  const imageDoc = "![Alt](image.png)";
  const imageTarget = imageDoc.indexOf("image.png") + 2;
  const imageView = createView(imageDoc, ImageExtension, imageTarget);
  imageView.dispatch({ changes: { from: imageTarget, insert: "-new" } });

  assert.equal(imageSetup.controller.isOpen(imageView), true);
  const imageBindings = imageView.state.facet(keymap).flat();
  assert.equal(imageBindings.find((binding) => binding.key === "ArrowDown")?.run?.(imageView), true);
  assert.equal(imageBindings.find((binding) => binding.key === "Escape")?.run?.(imageView), true);
  assert.equal(imageSetup.controller.isOpen(), false);

  const linkDoc = "[Site](https://example.com)";
  const linkTarget = linkDoc.indexOf("example") + 2;
  const linkView = createView(linkDoc, LinkExtension, linkTarget);
  linkView.dispatch({ selection: { anchor: 0 } });
  linkView.dispatch({ selection: { anchor: linkTarget } });
  assert.equal(linkSetup.controller.isOpen(), false);
  linkView.dispatch({ changes: { from: linkTarget, insert: "docs." } });

  assert.equal(linkSetup.controller.isOpen(linkView), true);
  linkView.dispatch({ selection: { anchor: 0 } });
  assert.equal(linkSetup.controller.isOpen(), false);
  assert.deepEqual(overlayHotkeys, ["images:ArrowDown"]);
});

test("replacing part of an image target opens its overlay", () => {
  const doc = "![Alt](old-image.png)";
  const target = doc.indexOf("old-image.png") + 2;
  const view = createView(doc, ImageExtension, target);

  view.dispatch({ changes: { from: target, to: target + 3, insert: "new" } });

  assert.equal(imageSetup.controller.isOpen(view), true);
  assert.equal(overlayRequest?.scope, "images");
});

test("overlay positioning uses separate horizontal and vertical caret geometry", () => {
  const view = {
    coordsAtPos: (position: number) =>
      position === 4
        ? ({ left: 12, right: 12, top: 20, bottom: 30 } as DOMRect)
        : ({ left: 40, right: 40, top: 50, bottom: 64 } as DOMRect),
  } as unknown as EditorView;

  assert.deepEqual(editorOverlayAnchor(view, 4, 9), { left: 12, top: 64 });
  assert.deepEqual(
    editorOverlayAnchor(
      {
        coordsAtPos: (position: number) =>
          position === 4 ? ({ left: 20, right: 20, top: 30, bottom: 44 } as DOMRect) : null,
      } as EditorView,
      4,
      9,
    ),
    { left: 20, top: 44 },
  );
  assert.equal(editorOverlayAnchor({ coordsAtPos: () => null } as unknown as EditorView, 4, 9), null);
});

test("buffered viewport follows a viewport that leaves its current buffer", async () => {
  const viewport = createBufferedViewport({ minBuffer: 1, maxBuffer: 1, multiplier: 0 });
  const plugin = viewport.extension[1] as ViewPlugin<PluginValue>;
  const view = createRawView("x".repeat(100), viewport.extension);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  view.dispatch({ effects: viewport.effect.of({ from: 0, to: 5 }) });

  const pluginValue = view.plugin(plugin);
  assert.ok(pluginValue?.update);
  pluginValue.update({
    docChanged: false,
    state: view.state,
    view: { viewport: { from: 20, to: 30 } } as EditorView,
    viewportChanged: true,
  } as ViewUpdate);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  assert.deepEqual(view.state.field(viewport.field), { from: 19, to: 31 });
});

test("image widgets preserve structural indentation and reveal source using the source button", async () => {
  const doc = "\n> - ![Diagram](nested-image.png)";
  const imageFrom = doc.indexOf("![");
  const imageTo = doc.length;
  const view = createView(doc, ImageExtension);
  await vi.waitFor(() => assert.ok(view.dom.querySelector(".cm-image-widget")));
  const widget = view.dom.querySelector<HTMLElement>(".cm-image-widget");

  assert.ok(widget);
  assert.ok(widget.classList.contains("cm-blockquote-line"));
  assert.match(widget.style.paddingLeft, /^calc/);

  widget.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true }));
  assert.equal(view.state.selection.main.head, 0);

  widget.querySelector<HTMLButtonElement>(".cm-image-source")!.click();
  assert.equal(view.state.selection.main.from, imageFrom);
  assert.equal(view.state.selection.main.to, imageTo);
});

test("image widgets preserve list indentation and reveal their source", async () => {
  const doc = "\n- ![Diagram](image.png)";
  const view = createView(doc, ImageExtension);
  await vi.waitFor(() => assert.ok(view.dom.querySelector(".cm-image-widget")));
  const widget = view.dom.querySelector<HTMLElement>(".cm-image-widget");

  assert.ok(widget);
  assert.equal(widget.style.paddingLeft, "2ch");
  widget.querySelector<HTMLButtonElement>(".cm-image-source")!.click();
  assert.equal(view.state.selection.main.from, doc.indexOf("![Diagram]"));
  assert.equal(view.state.selection.main.to, doc.length);
});

test("cancelled and late image probes cannot refresh stale editor views", () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  const createdImages: Array<{ onload: (() => void) | null }> = [];

  class DeferredImage {
    decoding = "";
    height = 0;
    naturalHeight = 10;
    naturalWidth = 10;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(_value: string) {
      createdImages.push(this);
    }
  }

  vi.stubGlobal("Image", DeferredImage);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  const materializeImageWidget = (view: EditorView) => {
    const result: { widget?: { toDOM(view: EditorView): HTMLElement } } = {};
    buildImageDecorations(view.state).between(0, view.state.doc.length, (_from, _to, decoration) => {
      result.widget ??= decoration.spec.widget;
    });
    const { widget } = result;
    assert.ok(widget);
    widget.toDOM(view);
  };

  const cancelled = createView("\n![](cancelled-probe.png)", ImageExtension);
  materializeImageWidget(cancelled);
  const cancelledFrom = cancelled.state.doc.toString().indexOf("cancelled-probe.png");
  imageSetup.controller.open(
    cancelled,
    {
      activePos: [cancelledFrom, cancelledFrom + "cancelled-probe.png".length],
      anchorPos: cancelledFrom,
      src: "cancelled-probe.png",
    },
    cancelledFrom,
  );
  overlayRequest?.select("cancelled-probe.png");
  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 0);

  const detached = createView("\n![](detached-probe.png)", ImageExtension);
  materializeImageWidget(detached);
  detached.dom.parentElement?.remove();
  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 0);

  const late = createView("\n![](late-probe.png)", ImageExtension);
  materializeImageWidget(late);
  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 1);

  const parent = late.dom.parentElement;
  views.splice(views.indexOf(late), 1);
  late.destroy();
  parent?.remove();
  createdImages[0].onload?.();
});

test("an editor initialized off-DOM does not schedule an image probe", () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  const parent = document.createElement("div");
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "\n![](off-dom-probe.png)",
      extensions: [obimMarkdown(), ImageExtension],
    }),
  });
  views.push(view);

  assert.equal(view.dom.isConnected, false);
  const result: { widget?: { toDOM(view: EditorView): HTMLElement } } = {};
  buildImageDecorations(view.state).between(0, view.state.doc.length, (_from, _to, decoration) => {
    result.widget ??= decoration.spec.widget;
  });
  const { widget } = result;
  assert.ok(widget);
  assert.ok(widget.toDOM(view).classList.contains("cm-image-widget"));
  assert.equal(idleCallbacks.length, 0);
});

test("successful image probing replaces the loading state with the measured image", async () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  const createdImages: Array<{
    onload: (() => void) | null;
  }> = [];

  class LoadedImage {
    decoding = "";
    height = 0;
    naturalHeight = 360;
    naturalWidth = 640;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(_value: string) {
      createdImages.push(this);
    }
  }

  vi.stubGlobal("Image", LoadedImage);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  const view = createView("\n![Diagram](loaded-interaction.png)", ImageExtension);
  await vi.waitFor(() => assert.match(view.dom.querySelector(".cm-image-widget")?.textContent ?? "", /^Loading image/));

  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 1);
  createdImages[0].onload?.();

  await vi.waitFor(() => assert.ok(view.dom.querySelector(".cm-image-frame img")));
  const image = view.dom.querySelector<HTMLImageElement>(".cm-image-frame img");
  assert.ok(image);
  assert.equal(image.alt, "Diagram");
  assert.equal(image.width, 640);
  assert.equal(image.height, 360);
  assert.equal(image.getAttribute("src"), "media:///loaded-interaction.png");

  const widget = view.dom.querySelector(".cm-image-widget");
  view.dispatch({ changes: { from: view.state.doc.length, insert: "\ncaption" } });
  assert.equal(view.dom.querySelector(".cm-image-widget"), widget);
});

test("Obsidian image embeds load the workspace path returned by their resolver", async () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  const createdImages: Array<{ onload: (() => void) | null; src: string }> = [];

  class LoadedImage {
    decoding = "";
    height = 0;
    naturalHeight = 360;
    naturalWidth = 640;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(value: string) {
      createdImages.push({ onload: this.onload, src: value });
    }
  }

  vi.stubGlobal("Image", LoadedImage);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  const image = createImageExtension({
    owner: "wiki-image-load",
    overlay: overlayPort,
    actions: {
      resolveSource: (_src, syntax) =>
        syntax === "wiki" ? "Third Semester/Pasted image wiki-load-coverage.png" : null,
      open() {},
      contextMenu() {},
    },
  });
  const view = createView("\n![[Pasted image wiki-load-coverage.png]]", image.extension);
  await vi.waitFor(() => assert.ok(view.dom.querySelector(".cm-image-loading")));

  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 1);
  assert.equal(createdImages[0].src, "media:///Third%20Semester/Pasted%20image%20wiki-load-coverage.png");
  createdImages[0].onload?.();

  await vi.waitFor(() => {
    assert.equal(
      view.dom.querySelector<HTMLImageElement>(".cm-image-frame img")?.getAttribute("src"),
      "media:///Third%20Semester/Pasted%20image%20wiki-load-coverage.png",
    );
  });
});

test("unresolved Obsidian image embeds show missing state without probing the workspace root", async () => {
  const requestedSources: string[] = [];

  class UnexpectedImage {
    decoding = "";
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(value: string) {
      requestedSources.push(value);
    }
  }

  vi.stubGlobal("Image", UnexpectedImage);
  const image = createImageExtension({
    owner: "missing-wiki-image",
    overlay: overlayPort,
    actions: {
      resolveSource: () => null,
      open() {},
      contextMenu() {},
    },
  });
  const view = createView("\n![[missing-wiki-image.png]]", image.extension);

  await vi.waitFor(() => {
    assert.equal(view.dom.querySelector(".cm-image-error")?.textContent, "Image 'missing-wiki-image.png' not found");
  });
  assert.deepEqual(requestedSources, []);
});

test("views sharing an image share one failed probe and refresh together", async () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  const createdImages: Array<{ onerror: (() => void) | null }> = [];

  class MissingImage {
    decoding = "";
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(_value: string) {
      createdImages.push(this);
    }
  }

  vi.stubGlobal("Image", MissingImage);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  const source = "shared-missing-coverage.png";
  const first = createView(`\n![](${source})`, ImageExtension);
  const second = createView(`\n![](${source})`, ImageExtension);
  await vi.waitFor(() => {
    assert.ok(first.dom.querySelector(".cm-image-loading"));
    assert.ok(second.dom.querySelector(".cm-image-loading"));
  });

  assert.equal(idleCallbacks.length, 1);
  idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(createdImages.length, 1);
  createdImages[0].onerror?.();

  await vi.waitFor(() => {
    assert.equal(first.dom.querySelector(".cm-image-error")?.textContent, `Image '${source}' not found`);
    assert.equal(second.dom.querySelector(".cm-image-error")?.textContent, `Image '${source}' not found`);
  });
});

test("relative image load results are cached only within the current workspace", async () => {
  const originalConfig = window.config;
  let workspacePath = "/workspace-a";
  window.config = {
    ...originalConfig,
    getMainDirectoryPathSync: () => workspacePath,
  };

  const idleCallbacks: IdleRequestCallback[] = [];
  const createdImages: Array<{ onerror: (() => void) | null; src: string }> = [];

  class MissingImage {
    decoding = "";
    height = 0;
    naturalHeight = 0;
    naturalWidth = 0;
    onerror: (() => void) | null = null;
    onload: (() => void) | null = null;
    width = 0;

    set src(value: string) {
      createdImages.push({ onerror: this.onerror, src: value });
    }
  }

  vi.stubGlobal("Image", MissingImage);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });

  try {
    const source = "same-relative-path-workspace-cache.png";
    const first = createView(`\n![](${source})`, ImageExtension);
    await vi.waitFor(() => assert.ok(first.dom.querySelector(".cm-image-loading")));
    assert.equal(idleCallbacks.length, 1);
    idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
    assert.equal(createdImages.length, 1);
    createdImages[0].onerror?.();
    await vi.waitFor(() => assert.ok(first.dom.querySelector(".cm-image-error")));

    workspacePath = "/workspace-b";
    const second = createView(`\n![](${source})`, ImageExtension);
    await vi.waitFor(() => assert.ok(second.dom.querySelector(".cm-image-loading")));
    assert.equal(idleCallbacks.length, 1);
    idleCallbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });

    assert.equal(createdImages.length, 2);
    assert.deepEqual(
      createdImages.map(({ src }) => src),
      [`media:///${source}`, `media:///${source}`],
    );
  } finally {
    window.config = originalConfig;
  }
});

test("math widgets render KaTeX and reveal their exact source content on pointer input", async () => {
  const doc = "\nbefore $q_{coverage}$ and $$d_{coverage}$$ after\n\n$$\nr_{coverage}\n$$";
  const view = createView(doc, MathBlockExtension);

  await vi.waitFor(() => assert.equal(view.dom.querySelectorAll(".katex").length, 3));
  const inline = view.dom.querySelector<HTMLElement>(".cm-math-widget-inline:not(.cm-math-widget-display-inline)");
  assert.ok(inline);
  inline.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "q_{coverage}");

  const inlineBlock = view.dom.querySelector<HTMLElement>(".cm-math-widget-display-inline");
  assert.ok(inlineBlock);
  assert.ok(inlineBlock.querySelector(".katex-display"));
  inlineBlock.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "d_{coverage}");

  const block = view.dom.querySelector<HTMLElement>(".cm-math-widget-block:not(.cm-math-widget-live-preview)");
  assert.ok(block);
  block.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "r_{coverage}");
  const livePreview = view.dom.querySelector<HTMLElement>(".cm-math-widget-live-preview");
  assert.ok(livePreview);

  const selected = view.state.selection.main;
  view.dispatch({ changes: { from: selected.from, to: selected.to, insert: "s_{updated}" } });
  await vi.waitFor(() =>
    assert.equal(view.dom.querySelector(".cm-math-widget-live-preview annotation")?.textContent?.trim(), "s_{updated}"),
  );
  assert.equal(view.dom.querySelector(".cm-math-widget-live-preview"), livePreview);
});

test("mapped math widgets select their shifted source after ordinary edits", () => {
  const view = createView("before\n$$\nmapped_source\n$$", MathBlockExtension);
  const widget = view.dom.querySelector<HTMLElement>(".cm-math-widget-block");
  assert.ok(widget);

  view.dispatch({ changes: { from: 0, insert: "prefix\n" } });
  widget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "mapped_source");

  const quoted = createView("> $$\n> quoted_source\n> $$", MathBlockExtension);
  const quotedWidget = quoted.dom.querySelector<HTMLElement>(".cm-math-widget-blockquote");
  assert.ok(quotedWidget);
  quotedWidget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  assert.equal(
    quoted.state.sliceDoc(quoted.state.selection.main.from, quoted.state.selection.main.to),
    "> quoted_source\n> ",
  );
});

test("programmatic math replacements refresh inactive inline, block, and quoted widgets", async () => {
  const doc = "\n$x_external$\n\n$$\ny_external\n$$";
  const view = createView(doc, MathBlockExtension);
  await vi.waitFor(() => assert.equal(view.dom.querySelectorAll(".katex").length, 2));

  const inline = view.dom.querySelector(".cm-math-widget-inline");
  const block = view.dom.querySelector(".cm-math-widget-block");
  const blockFrom = doc.indexOf("$$");
  const inlineFrom = doc.indexOf("$");
  view.dispatch({
    changes: [
      { from: inlineFrom, to: inlineFrom + "$x_external$".length, insert: "$z_external$" },
      { from: blockFrom, to: doc.length, insert: "$$\nw_external\n$$" },
    ],
  });

  await vi.waitFor(() => {
    const annotations = [...view.dom.querySelectorAll("annotation")].map((element) => element.textContent?.trim());
    assert.deepEqual(annotations, ["z_external", "w_external"]);
  });
  assert.equal(view.dom.querySelector(".cm-math-widget-inline"), inline);
  assert.equal(view.dom.querySelector(".cm-math-widget-block"), block);

  const quoted = createView("\n> $$\n> quoted_{coverage}\n> $$", MathBlockExtension);
  await vi.waitFor(() => assert.ok(quoted.dom.querySelector(".cm-math-widget-blockquote .katex")));
  assert.ok(quoted.dom.querySelector(".cm-math-widget-blockquote.cm-blockquote-depth-1"));

  const empty = createView("", MathBlockExtension);
  assert.equal(empty.dom.querySelector(".cm-math-widget"), null);
});

test("reused math widget DOM synchronizes display mode and quote-depth classes", () => {
  const inline = createView("\n$x$", MathBlockExtension);
  const inlineWidget = inline.dom.querySelector<HTMLElement>(".cm-math-widget-inline");
  assert.ok(inlineWidget);

  assert.equal(mathWidgetFromDocument("\nbefore $$x$$ after", "MathInlineWidget").updateDOM(inlineWidget), true);
  assert.ok(inlineWidget.classList.contains("cm-math-widget-display-inline"));

  const quoted = createView("\n> $$\n> x\n> $$", MathBlockExtension);
  const quotedWidget = quoted.dom.querySelector<HTMLElement>(".cm-math-widget-blockquote");
  assert.ok(quotedWidget);
  assert.ok(quotedWidget.classList.contains("cm-blockquote-depth-1"));

  assert.equal(mathWidgetFromDocument("\n> > $$\n> > x\n> > $$", "MathBlockWidget").updateDOM(quotedWidget), true);
  assert.ok(quotedWidget.classList.contains("cm-blockquote-depth-2"));
  assert.equal(quotedWidget.classList.contains("cm-blockquote-depth-1"), false);
});

test("math widgets preserve their DOM while source edits change display mode and quote depth", () => {
  const inline = createView("\nbefore $x$ after", MathBlockExtension);
  const inlineWidget = inline.dom.querySelector<HTMLElement>(".cm-math-widget-inline");
  assert.ok(inlineWidget);
  const inlineSource = inline.state.doc.toString();
  const opening = inlineSource.indexOf("$");
  const closing = inlineSource.lastIndexOf("$");

  inline.dispatch({
    changes: [
      { from: opening, to: opening + 1, insert: "$$" },
      { from: closing, to: closing + 1, insert: "$$" },
    ],
  });
  assert.equal(inline.dom.querySelector(".cm-math-widget-inline"), inlineWidget);
  assert.ok(inlineWidget.classList.contains("cm-math-widget-display-inline"));

  const displaySource = inline.state.doc.toString();
  const displayOpening = displaySource.indexOf("$$");
  const displayClosing = displaySource.lastIndexOf("$$");
  inline.dispatch({
    changes: [
      { from: displayOpening, to: displayOpening + 2, insert: "$" },
      { from: displayClosing, to: displayClosing + 2, insert: "$" },
    ],
  });
  assert.equal(inline.dom.querySelector(".cm-math-widget-inline"), inlineWidget);
  assert.equal(inlineWidget.classList.contains("cm-math-widget-display-inline"), false);

  const quoted = createView("\n> $$\n> x\n> $$", MathBlockExtension);
  const quotedWidget = quoted.dom.querySelector<HTMLElement>(".cm-math-widget-blockquote");
  assert.ok(quotedWidget);
  assert.ok(quotedWidget.classList.contains("cm-blockquote-depth-1"));

  quoted.dispatch({ changes: { from: 0, to: quoted.state.doc.length, insert: "\n> > $$\n> > x\n> > $$" } });
  assert.equal(quoted.dom.querySelector(".cm-math-widget-blockquote"), quotedWidget);
  assert.ok(quotedWidget.classList.contains("cm-blockquote-depth-2"));
  assert.equal(quotedWidget.classList.contains("cm-blockquote-depth-1"), false);
});

test("pointer dragging rebuilds math decorations once after the drag finishes", async () => {
  const doc = "before $drag_{coverage}$ after";
  const view = createView(doc, MathBlockExtension);
  const initialDecorations = mathDecorationSource(view);
  const observed = [initialDecorations];

  view.contentDOM.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
  observed.push(mathDecorationSource(view));

  for (const head of [doc.indexOf("drag"), doc.indexOf("after"), doc.length]) {
    view.dispatch({ selection: { anchor: 0, head }, userEvent: "select.pointer" });
    observed.push(mathDecorationSource(view));
  }

  assert.equal(new Set(observed).size, 1);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  assert.equal(mathDecorationSource(view), initialDecorations);

  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const finishedDecorations = mathDecorationSource(view);
  assert.notEqual(finishedDecorations, initialDecorations);
  assert.equal(new Set([...observed, finishedDecorations]).size, 2);
});

test("deeply quoted math caps its visual nesting class", async () => {
  const prefix = "> ".repeat(5);
  const view = createView(`\n${prefix}$$\n${prefix}deep_{coverage}\n${prefix}$$`, MathBlockExtension);

  await vi.waitFor(() => assert.ok(view.dom.querySelector(".cm-math-widget-blockquote .katex")));
  assert.ok(view.dom.querySelector(".cm-math-widget-blockquote.cm-blockquote-depth-4"));
});

test("math widgets render synchronously without idle-time layout changes", () => {
  const idleCallbacks: IdleRequestCallback[] = [];
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idleCallbacks.push(callback);
    return idleCallbacks.length;
  });
  const doc = "\n$batch_a$ $batch_b$ $batch_c$ $batch_d$ $batch_a$";
  const view = createView(doc, MathBlockExtension);

  assert.equal(view.dom.querySelectorAll(".katex").length, 5);
  assert.equal(view.dom.querySelectorAll(".cm-math-widget-pending").length, 0);
  assert.equal(idleCallbacks.length, 0);

  const cached = createView("\n$batch_a$", MathBlockExtension);
  assert.ok(cached.dom.querySelector(".katex"));
  assert.equal(idleCallbacks.length, 0);
});

test("math widgets reflect source changes in the same transaction", () => {
  const view = createView("\n$stale_render_a$", MathBlockExtension);

  const from = view.state.doc.toString().indexOf("stale_render_a");
  view.dispatch({ changes: { from, to: from + "stale_render_a".length, insert: "stale_render_b" } });

  assert.equal(view.dom.querySelector(".cm-math-widget annotation")?.textContent?.trim(), "stale_render_b");
});

test("math decoration state distinguishes delimiter, newline, and ordinary edits", () => {
  const delimiter = createView("plain", MathBlockExtension);
  delimiter.dispatch({ changes: { from: delimiter.state.doc.length, insert: "$" } });
  delimiter.dispatch({ changes: { from: delimiter.state.doc.length - 1, to: delimiter.state.doc.length } });

  const newline = createView("plain", MathBlockExtension);
  newline.dispatch({ changes: { from: newline.state.doc.length, insert: "\n" } });

  const ordinary = createView("plain", MathBlockExtension);
  ordinary.dispatch({ changes: { from: 0, to: 1, insert: "P" } });

  assert.equal(delimiter.state.doc.toString(), "plain");
  assert.equal(newline.state.doc.toString(), "plain\n");
  assert.equal(ordinary.state.doc.toString(), "Plain");
});

test("code block controls render their language and copy the complete code", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const view = createView("\n```ts\nconst x = 1;\nconsole.log(x);\n```", CodeBlockExtension);
  const container = view.dom.querySelector<HTMLElement>(".cm-formatting-codeblock-language-container");
  const button = container?.querySelector<HTMLButtonElement>("button");

  assert.ok(container);
  assert.deepEqual(
    [...view.dom.querySelectorAll<HTMLElement>(".cm-line[data-code-line-number]")].map(
      (line) => line.dataset.codeLineNumber,
    ),
    ["1", "2"],
  );
  assert.equal(container.querySelector(".cm-formatting-codeblock-language")?.textContent, "ts");
  assert.ok(container.querySelector("svg path"));
  assert.ok(button);

  button.dispatchEvent(new MouseEvent("mouseover"));
  assert.equal(button.style.backgroundColor, "var(--surface-hover)");
  button.dispatchEvent(new MouseEvent("mouseout"));
  assert.equal(button.style.backgroundColor, "transparent");

  const initialIcon = button.innerHTML;
  button.click();
  await Promise.resolve();

  assert.deepEqual(writeText.mock.calls, [["const x = 1;\nconsole.log(x);"]]);
  assert.notEqual(button.innerHTML, initialIcon);

  await vi.advanceTimersByTimeAsync(3000);
  assert.equal(button.innerHTML, initialIcon);
});

test("a rejected clipboard write leaves the code copy control unchanged", async () => {
  const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const view = createView("\n```js\nvalue\n```", CodeBlockExtension);
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-formatting-codeblock-language-container button");

  assert.ok(button);
  const initialIcon = button.innerHTML;
  button.click();
  await vi.waitFor(() => assert.equal(writeText.mock.calls.length, 1));

  assert.equal(button.innerHTML, initialIcon);
});

test("explicit CSV clipboard data uses the paste handler and replaces the selection", () => {
  const view = createView("replace me", PasteExtension);
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  const event = pasteEvent({
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    types: ["text/plain", "text/csv"],
    getData: () => "Name,Age\nAda,36",
  });

  view.contentDOM.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(view.state.doc.toString(), "| Name | Age |\n| ---- | --- |\n| Ada  | 36  |");
});

test("paste extension leaves ordinary text to CodeMirror's normal input path", () => {
  const view = createView("unchanged", PasteExtension);
  const event = pasteEvent({
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    getData: () => "ordinary text",
  });

  view.contentDOM.dispatchEvent(event);

  assert.equal(view.state.doc.toString(), "ordinary textunchanged");
});

test("file drops embed viewable images and link other files", () => {
  registerAppDndBridge({
    canCommit: () => true,
    complete: () => undefined,
    getActiveEntity: () => ({ kind: "explorer-item", id: "source" }),
    updateTarget: () => undefined,
  });
  for (const [mimeType, relativePath, expected] of [
    ["image/png", "assets/diagram.png", "![diagram](assets/diagram.png)"],
    ["text/markdown", "notes/plan.md", "[plan](notes/plan.md)"],
  ]) {
    const view = createRawView("", fileDropExtension);
    const event = fileDropEvent({
      id: relativePath,
      filename: relativePath.split("/").at(-1)?.split(".")[0] ?? "",
      relativePath,
      path: `/notes/${relativePath}`,
      isDirectory: false,
      mimeType,
    });

    view.contentDOM.dispatchEvent(event);

    assert.equal(event.defaultPrevented, true);
    assert.equal(view.state.doc.toString(), expected);
  }
});

test("native image drops save an attachment and insert it at the drop position", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const file = { name: "diagram.png", type: "", arrayBuffer: vi.fn().mockResolvedValue(bytes) } as unknown as File;
  saveBinaryFile.mockResolvedValueOnce({ success: true });
  const view = createRawView("abcdef", PasteExtension);
  vi.spyOn(view, "posAtCoords").mockReturnValue(3);
  const dragover = nativeFileEvent("dragover", [file]);

  view.contentDOM.dispatchEvent(dragover.event);
  assert.equal(dragover.event.defaultPrevented, true);
  assert.equal(dragover.dataTransfer.dropEffect, "copy");

  const drop = nativeFileEvent("drop", [file]);
  view.contentDOM.dispatchEvent(drop.event);

  assert.equal(drop.event.defaultPrevented, true);
  await vi.waitFor(() => assert.match(view.state.doc.toString(), /^abc!\[\]\(attachments\/pasted-image-.+\.png\)def$/));
  assert.equal(saveBinaryFile.mock.lastCall?.[1], bytes);
  assert.equal(onFilesCreated.mock.calls.length, 1);
});

test("paste events without clipboard data are ignored", () => {
  const view = createView("unchanged", PasteExtension);

  view.contentDOM.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));

  assert.equal(view.state.doc.toString(), "unchanged");
});

test("image paste saves the binary and inserts an attachment link", async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const file = { type: "image/png", arrayBuffer: vi.fn().mockResolvedValue(bytes) } as unknown as File;
  saveBinaryFile.mockResolvedValueOnce({ success: true });
  const view = createView("", PasteExtension);
  const event = pasteEvent(imageClipboardData(file));

  view.contentDOM.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  await vi.waitFor(() => assert.match(view.state.doc.toString(), /^!\[\]\(attachments\/pasted-image-.+\.png\)$/));
  assert.equal(saveBinaryFile.mock.calls[0].length, 2);
  assert.equal(saveBinaryFile.mock.calls[0][1], bytes);
  assert.equal(onFilesCreated.mock.calls.length, 1);
});

test("image paste falls back to clipboard files when data-transfer items are empty", async () => {
  const file = {
    type: "image/jpeg",
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as File;
  saveBinaryFile.mockResolvedValueOnce({ success: true });
  const view = createView("", PasteExtension);
  const event = pasteEvent({
    items: [
      {
        kind: "file",
        type: "image/jpeg",
        getAsFile: () => null,
      },
    ] as unknown as DataTransferItemList,
    files: [file] as unknown as FileList,
    getData: () => "",
  });

  view.contentDOM.dispatchEvent(event);

  await vi.waitFor(() => assert.match(view.state.doc.toString(), /\.jpg\)$/));
  assert.equal(event.defaultPrevented, true);
});

test("pasting a copied filesystem image imports it and inserts its attachment link", async () => {
  hasClipboardImageFiles.mockReturnValueOnce(true);
  importClipboardImages.mockResolvedValueOnce({ errors: [], relativePaths: ["attachments/local-image.png"] });
  const view = createView("", PasteExtension);
  const event = pasteEvent({
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    getData: () => "",
  });

  view.contentDOM.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  await vi.waitFor(() => assert.equal(view.state.doc.toString(), "![](attachments/local-image.png)"));
  assert.equal(importClipboardImages.mock.calls.length, 1);
  assert.equal(onFilesCreated.mock.calls.length, 1);
});

test("failed image paste reports the failure without inserting a broken link", async () => {
  const file = {
    type: "image/webp",
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  } as unknown as File;
  saveBinaryFile.mockResolvedValueOnce({ success: false, error: "disk full" });
  const view = createView("", PasteExtension);
  view.contentDOM.dispatchEvent(pasteEvent(imageClipboardData(file)));

  await vi.waitFor(() => assert.equal(notify.mock.calls[0]?.[0].title, "Image paste failed"));
  assert.equal(view.state.doc.toString(), "");
  assert.equal(onFilesCreated.mock.calls.length, 0);
});

test("table extensions initialize against the same Markdown language support as the editor", () => {
  const markdownSetup = obimMarkdown();
  const doc = "| Name | Age |\n| ---- | --- |\n| Ada  | 36  |";
  const view = createRawView(doc, [markdownSetup, tableExtensions(markdownSetup)]);

  assert.equal(view.state.doc.toString(), doc);
  assert.ok(view.dom.querySelector(".cm-content"));
});

test("formatting markers retain the class hidden by rendered table cells", () => {
  const view = createRawView("**Bold**", [obimMarkdown(), basicLight]);
  const spans = view.contentDOM.querySelectorAll(".cm-line > span");

  assert.equal(spans.length, 3);
  assert.equal(spans[0].classList.contains("cm-obim-formatting-mark"), true);
  assert.equal(spans[1].classList.contains("cm-obim-formatting-mark"), false);
  assert.equal(spans[2].classList.contains("cm-obim-formatting-mark"), true);
});

test("table search syntax mode is limited to queries that occur inside a table", () => {
  const state = EditorState.create({
    doc: "Outside\n\n| Name | Age |\n| ---- | --- |\n| Ada  | 36  |",
    extensions: obimMarkdown(),
  });

  assert.equal(queryMatchesTable(state, new SearchQuery({ search: "Ada" })), true);
  assert.equal(queryMatchesTable(state, new SearchQuery({ search: "Outside" })), false);
});

test("table search analysis is reused for equivalent queries on the same document tree", () => {
  const state = EditorState.create({
    doc: "Outside\n\n| Name | Age |\n| ---- | --- |\n| Ada  | 36  |",
    extensions: obimMarkdown(),
  });
  const query = new SearchQuery({ search: "Ada" });
  const getCursor = vi.spyOn(query, "getCursor");

  assert.equal(queryMatchesTable(state, query), true);
  assert.equal(queryMatchesTable(state, query), true);
  assert.equal(getCursor.mock.calls.length, 1);

  const equivalent = new SearchQuery({ search: "Ada" });
  const equivalentGetCursor = vi.spyOn(equivalent, "getCursor");
  assert.equal(queryMatchesTable(state, equivalent), true);
  assert.equal(equivalentGetCursor.mock.calls.length, 0);

  const changed = state.update({ changes: { from: 0, insert: "Changed\n" } }).state;
  assert.equal(queryMatchesTable(changed, query), true);
  assert.equal(getCursor.mock.calls.length, 2);
});

test("the editor setup composes the rendered Markdown behaviors", () => {
  const doc = "---\ntitle: Note\n---\nbody\n\n- [ ] task\n\n---\n\n[Note](note.md)";
  const view = createRawView(
    doc,
    createEditorExtensions({
      isMarkdown: true,
      owner: "setup-interaction",
      overlay: overlayPort,
      notify,
      openResource() {},
      openExternal() {},
      noteHeader: [],
    }),
    doc.indexOf("body") + 1,
  );

  assert.doesNotMatch(view.contentDOM.textContent ?? "", /title:\s*Note/);
  assert.ok(view.dom.querySelector(".cm-task-list-checkbox"));
  assert.ok(view.dom.querySelector(".cm-horizontal-rule-widget"));
  assert.equal(view.dom.querySelector(".cm-link-placeholder")?.textContent, "Note");
  assert.equal(openSearchPanel(view), true);
  assert.ok(view.dom.querySelector('.cm-panels-top [role="search"] input[aria-label="Find"]'));
});
