import assert from "node:assert/strict";
import { history, redo, selectAll, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, test, vi } from "vitest";
import { createStore } from "jotai";

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

import { fileDropExtension, normalizeTabsOnPaste } from "../src/renderer/src/features/editor/editorInput";
import { registerAppDndBridge } from "../src/renderer/src/shared/dnd/bridge";
import {
  markdownImagesInText,
  markdownLinksInText,
} from "../src/renderer/src/features/editor/extensions/shared/OverlayMarkdown";
import { FILE_DRAG_DATA_MIME } from "../src/shared/drag-data";
import {
  FrontmatterExtension,
  setFrontmatterSourceEditingEffect,
} from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { createPasteExtension } from "../src/renderer/src/features/editor/extensions/PasteExtension";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";
import { beginWorkspaceTransition, waitForWorkspaceActivity } from "../src/renderer/src/store/workspaceTransitionStore";

installCodeMirrorDomPolyfills();
const views: EditorView[] = [];
const properties = "---\ntags: [important]\ncount: 12\n---\n";
const notify = vi.fn();
function createView(doc: string, extra: Extension = []) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      extensions: [history(), createPasteExtension(notify), normalizeTabsOnPaste(), FrontmatterExtension, extra],
    }),
  });
  views.push(view);
  return view;
}
function paste(view: EditorView, text: string, extra: Partial<DataTransfer> = {}) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [],
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
      ...extra,
    },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}
afterEach(() => {
  registerAppDndBridge(null);
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.restoreAllMocks();
  hasClipboardImageFiles.mockReset().mockReturnValue(false);
  importClipboardImages.mockReset();
  saveBinaryFile.mockReset();
  notify.mockReset();
});

test.each([false, true])("URL paste retains the selected label and frontmatter (reversed: %s)", (reversed) => {
  const original = properties + "OpenAI documentation";
  const view = createView(original);
  view.dispatch({
    selection: {
      anchor: reversed ? original.length : properties.length,
      head: reversed ? properties.length : original.length,
    },
  });
  const event = paste(view, "https://platform.openai.com/docs");
  const expected = properties + "[OpenAI documentation](https://platform.openai.com/docs)";
  assert.equal(event.defaultPrevented, true);
  assert.equal(view.state.doc.toString(), expected);
  assert.equal(view.state.selection.main.empty, true);
  assert.equal(view.state.selection.main.head, expected.length);
  assert.equal(hasClipboardImageFiles.mock.calls.length, 0);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), original);
  assert.equal(redo(view), true);
  assert.equal(view.state.doc.toString(), expected);
});

test("URL paste escapes label delimiters and preserves destination spelling", () => {
  const label = "Map [draft] \\ *notes*";
  const url = "https://example.com/map_(draft)?a=1&b=%20#part";
  const view = createView(label);
  selectAll(view);
  paste(view, ` ${url}\n`);
  assert.equal(
    view.state.doc.toString(),
    "[Map \\[draft\\] \\\\ *notes*](<https://example.com/map_(draft)?a=1\\&b=%20#part>)",
  );
  assert.equal(markdownLinksInText(view.state.doc.toString(), 0, null)[0]?.dest, url);
});

test.each([
  "ordinary text",
  "www.example.com",
  "mailto:hello@example.com",
  "javascript:alert(1)",
  "https://",
  "https://[invalid",
  "https://example.com trailing text",
  "https://example.com\nhttps://other.example.com",
  "https://example.com\ttrailing",
  "https://example.com/\u0001path",
  "https://example.com\\path",
])("non-single web URL keeps ordinary text paste: %j", (text) => {
  const view = createView("label");
  selectAll(view);
  paste(view, text);
  assert.equal(view.state.doc.toString(), text.replace(/\t/g, "    "));
});

test("URL paste at an empty cursor remains literal", () => {
  const view = createView("label");
  view.dispatch({ selection: { anchor: 5 } });
  paste(view, "https://example.com");
  assert.equal(view.state.doc.toString(), "labelhttps://example.com");
});

test.each(["Control", "Meta"])("%s+Shift+V pastes a URL literally over selected text", (modifier) => {
  const view = createView("label");
  selectAll(view);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "v",
      shiftKey: true,
      ctrlKey: modifier === "Control",
      metaKey: modifier === "Meta",
      bubbles: true,
    }),
  );
  paste(view, "https://example.com");
  assert.equal(view.state.doc.toString(), "https://example.com");
});

test("URL paste wraps multiple selections and inserts literal text at empty ranges", () => {
  const view = createView("one two ", EditorState.allowMultipleSelections.of(true));
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.range(0, 3),
      EditorSelection.range(7, 4),
      EditorSelection.cursor(8),
    ]),
  });
  paste(view, "https://example.com");
  assert.equal(view.state.doc.toString(), "[one](https://example.com) [two](https://example.com) https://example.com");
  assert.equal(view.state.selection.ranges.length, 3);
  assert.ok(view.state.selection.ranges.every((range) => range.empty));
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), "one two ");
});

test("URL paste preserves read-only selected text", () => {
  const view = createView("label", EditorState.readOnly.of(true));
  selectAll(view);
  paste(view, "https://example.com");
  assert.equal(view.state.doc.toString(), "label");
});

test("table payload claims paste before URL linking", () => {
  const view = createView("label");
  selectAll(view);
  paste(view, "https://example.com", {
    types: ["text/plain", "text/csv"],
    getData: (type) => (type === "text/csv" ? "A,B\n1,2" : "https://example.com"),
  });
  assert.equal(view.state.doc.toString(), "| A   | B   |\n| --- | --- |\n| 1   | 2   |");
});

test("image payload claims paste before URL linking", async () => {
  saveBinaryFile.mockResolvedValueOnce({ success: true });
  const file = { type: "image/png", name: "image.png", arrayBuffer: async () => new ArrayBuffer(0) } as File;
  const view = createView("label");
  selectAll(view);
  paste(view, "https://example.com", { files: [file] as unknown as FileList });
  await vi.waitFor(() => assert.match(view.state.doc.toString(), /^!\[\]\(attachments\/pasted-image-.+\.png\)$/));
  assert.equal(saveBinaryFile.mock.calls.length, 1);
});

test.each([
  ["ordinary text", "Replacement body", "Replacement body"],
  ["multiline text", "First\nSecond", "First\nSecond"],
  ["tabs", "First\tSecond", "First    Second"],
  ["CSV-like plain text", "Name,Age\nAda,36", "Name,Age\nAda,36"],
])("E01 Select All and %s paste preserves properties in one undo step", (_name, input, expected) => {
  const original = `${properties}Old body`;
  const view = createView(original);
  selectAll(view);
  paste(view, input);
  assert.equal(view.state.doc.toString(), properties + expected);
  assert.equal(view.state.selection.main.head, view.state.doc.length);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), original);
  assert.equal(redo(view), true);
  assert.equal(view.state.doc.toString(), properties + expected);
});

test("E01 input crossing the hidden boundary replaces only selected body text", () => {
  const view = createView(properties + "First KEEP");
  view.dispatch({ changes: { from: 0, to: properties.length + 5, insert: "New" }, userEvent: "input.paste" });
  assert.equal(view.state.doc.toString(), properties + "New KEEP");
});

test("E01 reversed boundary-crossing selections and deletions preserve properties", () => {
  const view = createView(properties + "First KEEP");
  view.dispatch({ selection: { anchor: properties.length + 5, head: 2 } });
  assert.equal(view.state.selection.main.from, properties.length);
  paste(view, "New");
  assert.equal(view.state.doc.toString(), properties + "New KEEP");
  selectAll(view);
  view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.selection" });
  assert.equal(view.state.doc.toString(), properties);
});

test.each([properties, properties.trimEnd()])("E01 empty body remains editable after paste: %j", (original) => {
  const view = createView(original);
  selectAll(view);
  paste(view, "Body");
  assert.equal(view.state.doc.toString(), properties + "Body");
  undo(view);
  assert.equal(view.state.doc.toString(), original);
});

test("E01 source mode intentionally allows replacement of the entire source", () => {
  const view = createView(properties + "Body");
  view.dispatch({ effects: setFrontmatterSourceEditingEffect.of(true) });
  selectAll(view);
  paste(view, "Source replacement");
  assert.equal(view.state.doc.toString(), "Source replacement");
});

function delayedImport() {
  let resolve!: (value: { relativePaths: string[]; errors: string[] }) => void;
  let reject!: (reason: Error) => void;
  const result = new Promise<{ relativePaths: string[]; errors: string[] }>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  hasClipboardImageFiles.mockReturnValueOnce(true);
  importClipboardImages.mockReturnValueOnce(result);
  return { complete: (path = "attachments/pasted.png") => resolve({ relativePaths: [path], errors: [] }), reject };
}

test("E02 delayed image paste tracks its original range while selection and preceding text change", async () => {
  const pending = delayedImport();
  const view = createView(properties + "target IMPORTANT");
  view.dispatch({ selection: { anchor: properties.length, head: properties.length + 6 } });
  paste(view, "");
  view.dispatch({ changes: { from: properties.length, insert: "Before " }, userEvent: "input.type" });
  const importantFrom = view.state.doc.toString().indexOf("IMPORTANT");
  view.dispatch({ selection: { anchor: importantFrom, head: importantFrom + 9 } });
  pending.complete();
  await vi.waitFor(() =>
    assert.equal(view.state.doc.toString(), properties + "Before ![](attachments/pasted.png) IMPORTANT"),
  );
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "IMPORTANT");
  undo(view);
  assert.equal(view.state.doc.toString(), properties + "Before target IMPORTANT");
});

test("E02 editing an import's original selection cancels its stale replacement", async () => {
  const pending = delayedImport();
  const view = createView("target IMPORTANT");
  view.dispatch({ selection: { anchor: 0, head: 6 } });
  paste(view, "");
  view.dispatch({ changes: { from: 0, to: 6, insert: "New writing" }, userEvent: "input.type" });
  pending.complete();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.state.doc.toString(), "New writing IMPORTANT");
});

test.each(["reconfigure", "setState", "close"])(
  "E02 %s discards completions owned by the previous editor document",
  async (action) => {
    const pending = delayedImport();
    const view = createView("Original");
    paste(view, "");
    if (action === "reconfigure") {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "Other note" },
        effects: StateEffect.reconfigure.of(createPasteExtension(notify)),
      });
    } else if (action === "setState") {
      view.setState(EditorState.create({ doc: "Other note", extensions: createPasteExtension(notify) }));
    } else {
      view.destroy();
    }
    pending.complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(view.state.doc.toString(), action === "close" ? "Original" : "Other note");
  },
);

test("E02 deleting the pending cursor target cancels insertion", async () => {
  const pending = delayedImport();
  const view = createView("abc def");
  view.dispatch({ selection: { anchor: 2 } });
  paste(view, "");
  view.dispatch({ changes: { from: 0, to: 3, insert: "New" }, userEvent: "input.type" });
  pending.complete();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.state.doc.toString(), "New def");
});

test("E02 simultaneous imports publish in paste order and undo independently", async () => {
  const view = createView("IMPORTANT");
  const first = delayedImport();
  paste(view, "");
  const second = delayedImport();
  paste(view, "");
  second.complete("attachments/second.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(view.state.doc.toString(), "IMPORTANT");
  first.complete("attachments/first.png");
  await vi.waitFor(() =>
    assert.equal(view.state.doc.toString(), "![](attachments/first.png)![](attachments/second.png)IMPORTANT"),
  );
  undo(view);
  assert.equal(view.state.doc.toString(), "![](attachments/first.png)IMPORTANT");
  undo(view);
  assert.equal(view.state.doc.toString(), "IMPORTANT");
});

test("E02 failed import reports once and does not block a later completed import", async () => {
  const view = createView("IMPORTANT");
  const first = delayedImport();
  paste(view, "");
  const second = delayedImport();
  paste(view, "");
  second.complete();
  first.reject(new Error("Import failed"));
  await vi.waitFor(() => assert.equal(view.state.doc.toString(), "![](attachments/pasted.png)IMPORTANT"));
  assert.equal(notify.mock.calls.length, 1);
  assert.equal(notify.mock.calls[0][0].title, "Image paste failed");
});

test("E02 delayed image drop maps its coordinates and leaves the later selection alone", async () => {
  let finish!: (result: { success: boolean }) => void;
  saveBinaryFile.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const file = { type: "image/png", name: "image.png", arrayBuffer: async () => new ArrayBuffer(0) };
  const view = createView(properties + "abc IMPORTANT");
  vi.spyOn(view, "posAtCoords").mockReturnValue(properties.length + 3);
  const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], items: [], files: [file] } });
  view.contentDOM.dispatchEvent(event);
  view.dispatch({ changes: { from: properties.length, insert: "Before " }, userEvent: "input.type" });
  const important = view.state.doc.toString().indexOf("IMPORTANT");
  view.dispatch({ selection: { anchor: important, head: important + 9 } });
  await vi.waitFor(() => assert.equal(saveBinaryFile.mock.calls.length, 1));
  finish({ success: true });
  await vi.waitFor(() =>
    assert.match(view.state.doc.toString(), /Before abc!\[\]\(attachments\/pasted-image-.+\.png\) IMPORTANT$/),
  );
  assert.ok(view.state.doc.toString().startsWith(properties));
  assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "IMPORTANT");
  undo(view);
  assert.equal(view.state.doc.toString(), properties + "Before abc IMPORTANT");
});

test("E02 image paste replacing the whole body preserves properties", async () => {
  const pending = delayedImport();
  const original = properties + "Old body";
  const view = createView(original);
  selectAll(view);
  paste(view, "");
  pending.complete();
  await vi.waitFor(() => assert.equal(view.state.doc.toString(), properties + "![](attachments/pasted.png)"));
  undo(view);
  assert.equal(view.state.doc.toString(), original);
});

test.each(["active", "completed"])(
  "E02 %s workspace transition invalidates the original import generation",
  async (phase) => {
    const pending = delayedImport();
    const view = createView("IMPORTANT");
    paste(view, "");
    const lease = beginWorkspaceTransition(createStore(), "Test transition");
    assert.ok(lease);
    try {
      if (phase === "completed") lease.release();
      pending.complete();
      await waitForWorkspaceActivity();
      assert.equal(view.state.doc.toString(), "IMPORTANT");
    } finally {
      lease.release();
    }
  },
);

test("E02 frozen workspace rejects newly initiated image import work", async () => {
  hasClipboardImageFiles.mockReturnValueOnce(true);
  const view = createView("IMPORTANT");
  const lease = beginWorkspaceTransition(createStore(), "Test transition");
  assert.ok(lease);
  try {
    paste(view, "");
    await waitForWorkspaceActivity();
    assert.equal(importClipboardImages.mock.calls.length, 0);
    assert.equal(view.state.doc.toString(), "IMPORTANT");
  } finally {
    lease.release();
  }
});

test.each([
  "Hello, Alice.\nThanks, Bob.",
  '"Hello, Alice"\n"Thanks, Bob"',
  "call(first, second)\ncall(third, fourth)",
  "Name,Age\nAda,36",
])("E08 plain text preserves comma-bearing content: %j", (input) => {
  const view = createView(properties + "Old body");
  selectAll(view);
  paste(view, input);
  assert.equal(view.state.doc.toString(), properties + input);
  undo(view);
  assert.equal(view.state.doc.toString(), properties + "Old body");
});

const spreadsheetHtml =
  "<table><tr><th>Name</th><th>Note</th></tr><tr><td>Ada</td><td>first<br>second | *value*</td></tr><tr><td></td><td></td></tr></table>";
function tableClipboard(html = spreadsheetHtml): Partial<DataTransfer> {
  return {
    types: ["text/plain", "text/html"],
    getData: (type) => (type === "text/html" ? html : "Name\tNote\nAda\tfirst"),
  };
}

test("E08 HTML spreadsheet paste preserves cells, empty rows, escaping and frontmatter", () => {
  const view = createView(properties + "Old body");
  selectAll(view);
  const event = paste(view, "", tableClipboard());
  assert.equal(event.defaultPrevented, true);
  const result = view.state.doc.toString();
  assert.ok(result.startsWith(properties + "| Name | Note"));
  assert.match(result, /first<br>second \\\| \\\*value\\\*/);
  assert.equal(result.slice(properties.length).split("\n").length, 4);
  undo(view);
  assert.equal(view.state.doc.toString(), properties + "Old body");
});

test.each(["Control", "Meta"])("E08 %s+Shift+V retains the spreadsheet's plain text", (modifier) => {
  const view = createView("");
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "v",
      shiftKey: true,
      ctrlKey: modifier === "Control",
      metaKey: modifier === "Meta",
      bubbles: true,
    }),
  );
  paste(view, "", tableClipboard());
  assert.equal(view.state.doc.toString(), "Name    Note\nAda    first");
});

test.each(["text/csv", "text/tab-separated-values"])(
  "E08 explicit %s imports a table while plain TSV only normalizes tabs",
  (type) => {
    const view = createView("");
    const text = type === "text/csv" ? "A,B\n1,2\n," : "A\tB\n1\t2\n\t";
    paste(view, text, { types: [type, "text/plain"], getData: () => text });
    assert.equal(view.state.doc.toString(), "| A   | B   |\n| --- | --- |\n| 1   | 2   |\n|     |     |");
    const plain = createView("");
    paste(plain, "A\tB\n1\t2");
    assert.equal(plain.state.doc.toString(), "A    B\n1    2");
  },
);

test.each([
  "<p>Hello, Alice.</p><p>Thanks, Bob.</p>",
  "<table><tr><td colspan='2'>Merged</td></tr><tr><td>A</td><td>B</td></tr></table>",
  "<table><tr><td><table><tr><td>Nested</td></tr></table></td></tr></table>",
  "<p>Summary before the table.</p><table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>",
  "<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table><p>Notes after the table.</p>",
])("E08 unsupported HTML content keeps the supplied plain text: %j", (html) => {
  const view = createView("");
  paste(view, "", {
    types: ["text/html", "text/plain"],
    getData: (type) => (type === "text/html" ? html : "Hello, Alice.\nThanks, Bob."),
  });
  assert.equal(view.state.doc.toString(), "Hello, Alice.\nThanks, Bob.");
});

test("E08 image and table clipboard formats are claimed by only the image handler", async () => {
  saveBinaryFile.mockResolvedValueOnce({ success: true });
  const file = { type: "image/png", name: "image.png", arrayBuffer: async () => new ArrayBuffer(0) } as File;
  const view = createView(properties + "Old body");
  selectAll(view);
  paste(view, "", { ...tableClipboard(), files: [file] as unknown as FileList });
  await vi.waitFor(() => assert.match(view.state.doc.toString(), /!\[\]\(attachments\/pasted-image-.+\.png\)$/));
  assert.equal(saveBinaryFile.mock.calls.length, 1);
  assert.ok(view.state.doc.toString().startsWith(properties));
  assert.doesNotMatch(view.state.doc.toString(), /\| Name/);
});

test.each([
  "nested/Project Map.png",
  "nested/diagram (draft).png",
  "nested/[map].png",
  "nested/100%.png",
  "nested/encoded%20literal.png",
  "nested/Zażółć 🧭.png",
  "nested/amp&copy;.png",
])("E07 pasted and dropped files preserve the actual destination: %s", async (destination) => {
  registerAppDndBridge({
    canCommit: () => true,
    complete: () => undefined,
    getActiveEntity: () => ({ kind: "explorer-item", id: destination }),
    updateTarget: () => undefined,
  });
  const pending = delayedImport();
  const pasted = createView(properties + "Old body");
  selectAll(pasted);
  paste(pasted, "");
  pending.complete(destination);
  await vi.waitFor(() => assert.equal(markdownImagesInText(pasted.state.doc.toString(), 0, null)[0]?.src, destination));
  for (const mimeType of ["image/png", "text/markdown"]) {
    const dropped = createView(properties, fileDropExtension);
    const file = {
      id: destination,
      path: `/notes/${destination}`,
      filename: "Map [draft]",
      relativePath: destination,
      mimeType,
      isDirectory: false,
    };
    const event = new MouseEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        types: [FILE_DRAG_DATA_MIME],
        getData: (type: string) => (type === FILE_DRAG_DATA_MIME ? JSON.stringify(file) : ""),
      },
    });
    dropped.contentDOM.dispatchEvent(event);
    assert.ok(dropped.state.doc.toString().startsWith(properties));
    const info =
      mimeType === "image/png"
        ? markdownImagesInText(dropped.state.doc.toString(), 0, null)[0]
        : markdownLinksInText(dropped.state.doc.toString(), 0, null)[0];
    assert.equal("src" in info ? info.src : info.dest, destination);
  }
});

test("E01 full editor paste and undo survive an extension rebuild between actions", async () => {
  const { createEditorExtensions } = await import("../src/renderer/src/features/editor/setup");
  const { createNoteHeaderExtension } =
    await import("../src/renderer/src/features/editor/extensions/NoteHeaderExtension");
  const fullExtensions = () =>
    createEditorExtensions({
      isMarkdown: true,
      owner: "native-repro",
      overlay: { open() {}, close() {}, hotkey() {} },
      notify,
      openResource() {},
      openExternal() {},
      noteHeader: createNoteHeaderExtension(
        "native",
        async () => true,
        () => {},
      ),
    });
  const original = properties + "Original body";
  const view = createView(original);
  view.dispatch({ effects: StateEffect.reconfigure.of([history(), fullExtensions()]) });
  selectAll(view);
  paste(view, "Replacement body");
  assert.equal(view.state.doc.toString(), properties + "Replacement body");
  view.dispatch({ effects: StateEffect.reconfigure.of([history(), fullExtensions()]) });
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), original);
});

test("E01 text paste does not lose its payload to a native image-clipboard probe", () => {
  const original = properties + "Original body";
  const view = createView(original);
  let text = "Replacement body";
  hasClipboardImageFiles.mockImplementationOnce(() => {
    text = "";
    return false;
  });
  selectAll(view);
  paste(view, text, { getData: (type) => (type === "text/plain" ? text : "") });
  assert.equal(hasClipboardImageFiles.mock.calls.length, 0);
  assert.equal(view.state.doc.toString(), properties + "Replacement body");
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), original);
});

test.each([
  ["text/html", "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Ada</td><td>36</td></tr></table>"],
  ["text/csv", "Name,Age\nAda,36"],
  ["text/tab-separated-values", "Name\tAge\nAda\t36"],
])("E08 %s-only clipboard tables are consumed before any native clipboard probe", (mime, payload) => {
  const original = properties + "Original body";
  const view = createView(original);
  let readable = true;
  hasClipboardImageFiles.mockImplementationOnce(() => {
    readable = false;
    return false;
  });
  selectAll(view);
  paste(view, "", { types: [mime], getData: (type) => (readable && type === mime ? payload : "") });
  assert.match(view.state.doc.toString(), /\| Name \| Age \|/);
  assert.match(view.state.doc.toString(), /\| Ada {2}\| 36 {2}\|/);
  assert.equal(view.state.doc.toString().startsWith(properties), true);
  assert.equal(hasClipboardImageFiles.mock.calls.length, 0);
  assert.equal(undo(view), true);
  assert.equal(view.state.doc.toString(), original);
});

test.each([false, true])(
  "E01 unavailable clipboard data preserves the selection (plain override: %s)",
  (plainOverride) => {
    const original = properties + "Keep this body";
    const view = createView(original);
    selectAll(view);
    if (plainOverride)
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    const event = paste(view, "", { types: [] });
    assert.equal(event.defaultPrevented, true);
    assert.equal(view.state.doc.toString(), original);
    assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), "Keep this body");
    assert.equal(undo(view), false);
  },
);
