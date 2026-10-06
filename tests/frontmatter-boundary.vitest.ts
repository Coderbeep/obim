import {
  cursorCharLeft,
  cursorCharRight,
  cursorDocStart,
  deleteCharBackward,
  deleteCharForward,
  history,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  editableBodyStart,
  setFrontmatterSourceEditingEffect,
} from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import { createNoteHeaderExtension } from "../src/renderer/src/features/editor/extensions/NoteHeaderExtension";
import { createEditorExtensions } from "../src/renderer/src/features/editor/setup";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

installCodeMirrorDomPolyfills();
const views: EditorView[] = [];
const prefixes = [
  "---\ntags: [demo]\n---\n",
  "---\n---\n",
  "---\n{ title: Demo }\n---\n",
  "---\r\ntitle: Demo\r\n---\r\n",
];

beforeEach(() => {
  vi.stubGlobal("api", {
    focusAppWindow() {},
    doesFileExist: async () => true,
    openFile: async () => "{}",
    queryWorkspaceProperty: async () => [],
    listWorkspaceFrontmatterFields: async () => [],
    upsertFile: async () => true,
  });
});

afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.unstubAllGlobals();
});

function createView(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      createEditorExtensions({
        isMarkdown: true,
        owner: "frontmatter-boundary",
        overlay: { open() {}, close() {}, hotkey() {} },
        notify() {},
        openResource() {},
        openExternal() {},
        noteHeader: createNoteHeaderExtension("Boundary", async () => true),
      }),
    ],
  });
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state,
  });
  views.push(view);
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return view;
}

function insert(view: EditorView, text: string) {
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input.type" });
}

function paste(view: EditorView, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [],
      files: [],
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  view.contentDOM.dispatchEvent(event);
}

const blockCases = [
  ["fenced code", "```js\nconst x = 1;\n```", "cm-formatting-codeblock-line-begin"],
  ["unclosed code", "```js\nconst x = 1;", "cm-formatting-codeblock-line-begin"],
  ["indented code", "    const x = 1;", "cm-formatting-codeblock-line-content-begin"],
  ["nested list", "- first\n  - nested\n- second", "cm-list-line"],
  ["ordered list", "1. first\n   1. nested\n2. second", "cm-list-line"],
  ["task list", "- [ ] first\n  - [x] nested", "cm-list-line"],
];

for (const prefix of prefixes) {
  test.each(blockCases)(
    `first-line %s decorations survive hidden YAML ${JSON.stringify(prefix)}`,
    (_name, body, className) => {
      const view = createView(prefix + body + "\n\nAfter");
      const firstLine = () => view.contentDOM.querySelector<HTMLElement>(".cm-line");
      expect(firstLine()?.classList.contains(className)).toBe(true);
      if (className === "cm-list-line") expect(firstLine()?.style.paddingLeft).not.toBe("");

      view.dispatch({ selection: { anchor: editableBodyStart(view.state) } });
      expect(firstLine()?.classList.contains(className)).toBe(true);
      view.dispatch({ effects: setFrontmatterSourceEditingEffect.of(true) });
      view.dispatch({ effects: setFrontmatterSourceEditingEffect.of(false) });
      expect(firstLine()?.classList.contains(className)).toBe(true);
    },
  );

  test(`movement, deletion, paste and history protect YAML ${JSON.stringify(prefix)}`, () => {
    const view = createView(prefix + "Body\nSecond");
    const original = view.state.doc.toString();
    const bodyFrom = editableBodyStart(view.state);
    const metadata = original.slice(0, bodyFrom);
    view.dispatch({ selection: { anchor: bodyFrom } });
    cursorCharLeft(view);
    cursorDocStart(view);
    expect(view.state.selection.main.head).toBe(bodyFrom);
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(bodyFrom + 1);
    cursorCharLeft(view);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe(original);
    expect(view.state.selection.main.head).toBe(bodyFrom);

    insert(view, "X");
    expect(view.state.doc.toString()).toBe(metadata + "XBody\nSecond");
    expect(view.state.selection.main.head).toBe(bodyFrom + 1);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(metadata + "XBody\nSecond");
    undo(view);
    view.dispatch({ selection: { anchor: bodyFrom } });
    deleteCharForward(view);
    expect(view.state.doc.toString()).toBe(metadata + "ody\nSecond");
    undo(view);

    selectAll(view);
    expect(view.state.selection.main.from).toBe(bodyFrom);
    paste(view, "- replacement\n  - nested");
    expect(view.state.doc.toString()).toBe(metadata + "- replacement\n  - nested");
    expect(view.contentDOM.querySelector(".cm-line")?.classList.contains("cm-list-line")).toBe(true);
    undo(view);
    expect(view.state.doc.toString()).toBe(original);
  });

  test.each(["characters", "whole input", "paste"])(
    `%s in YAML-only note without a final newline keeps order and caret ${JSON.stringify(prefix)}`,
    (mode) => {
      const view = createView(prefix.trimEnd());
      const original = view.state.doc.toString();
      view.focus();
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
      expect(view.contentDOM.querySelector(".cm-line")).not.toBeNull();
      if (mode === "paste") {
        paste(view, "Body");
      } else {
        for (const text of mode === "characters" ? ["B", "o", "d", "y"] : ["Body"]) {
          insert(view, text);
          expect(view.state.selection.main.head).toBe(view.state.doc.length);
        }
      }
      expect(view.state.doc.toString()).toBe(original + "\nBody");
      expect(view.state.selection.main.head).toBe(view.state.doc.length);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(original);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(original + "\nBody");
    },
  );
}
