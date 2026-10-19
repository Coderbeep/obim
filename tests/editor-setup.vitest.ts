import { createStore } from "jotai";
import assert from "node:assert/strict";
import { beginWorkspaceTransition } from "../src/renderer/src/store/workspaceTransitionStore";

import { deleteCharBackward, toggleComment } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { searchPanelOpen, getSearchQuery } from "@codemirror/search";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";
import { test, vi } from "vitest";

import {
  composeEditorExtensions,
  createEditorExtensions,
  type EditorExtensionParts,
} from "../src/renderer/src/features/editor/setup";

const marker = (name: string) => name as unknown as Extension;

const parts = Object.fromEntries(
  [
    "noteHeader",
    "markdown",
    "table",
    "paste",
    "tabNormalization",
    "fileDrop",
    "theme",
    "lineWrapping",
    "visualLineNavigation",
    "blockQuote",
    "codeBlock",
    "emphasis",
    "frontmatter",
    "heading",
    "image",
    "horizontalRule",
    "lists",
    "math",
    "formatting",
    "link",
    "outline",
    "indent",
    "shiftEnter",
  ].map((name) => [name, marker(name)]),
) as unknown as EditorExtensionParts;

test("Markdown editor composition preserves extension precedence", () => {
  assert.deepEqual(composeEditorExtensions({ isMarkdown: true, parts }), [
    "noteHeader",
    "markdown",
    "table",
    "paste",
    "tabNormalization",
    "fileDrop",
    "theme",
    "lineWrapping",
    "visualLineNavigation",
    "blockQuote",
    "codeBlock",
    "emphasis",
    "frontmatter",
    "heading",
    "image",
    "horizontalRule",
    "lists",
    "math",
    "formatting",
    "link",
    "outline",
    "indent",
    "shiftEnter",
  ]);
});

test("plain-text editor composition contains input normalization, theme, wrapping, navigation, and indentation", () => {
  assert.deepEqual(composeEditorExtensions({ isMarkdown: false, parts }), [
    "tabNormalization",
    "theme",
    "lineWrapping",
    "visualLineNavigation",
    "indent",
  ]);
});

test("editor keymaps leave the app comment shortcut free while preserving editing keys", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  for (const isMarkdown of [true, false]) {
    const extensions = createEditorExtensions({
      isMarkdown,
      owner: "shortcuts",
      overlay: { open() {}, close() {}, hotkey() {} },
      notify() {},
      openResource() {},
      openExternal() {},
      noteHeader: [],
    });
    const state = EditorState.create({ doc: "text", extensions });
    const bindings = state.facet(keymap).flat();
    assert.equal(
      bindings.some((binding) => binding.run === toggleComment),
      false,
    );
    assert.equal(
      bindings.some((binding) => binding.run === deleteCharBackward),
      true,
    );
  }
});

test("production editor extensions enforce a single selection", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const extensions = createEditorExtensions({
    isMarkdown: true,
    owner: "single-selection",
    overlay: { open() {}, close() {}, hotkey() {} },
    notify() {},
    openResource() {},
    openExternal() {},
    noteHeader: [],
  });
  const state = EditorState.create({
    doc: "one two",
    extensions: [extensions, EditorState.allowMultipleSelections.of(true)],
  });
  const transaction = state.update({
    selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(5)], 1),
  });

  assert.equal(transaction.state.selection.ranges.length, 1);
  assert.equal(transaction.state.selection.main.head, 5);
});

test("workspace transitions reject edits in both Markdown and plain-text editors", () => {
  const lease = beginWorkspaceTransition(createStore(), "Switching workspace");
  try {
    for (const isMarkdown of [true, false]) {
      const state = EditorState.create({
        doc: "Preserve this text",
        extensions: createEditorExtensions({
          isMarkdown,
          owner: "transition",
          overlay: { open() {}, close() {}, hotkey() {} },
          notify() {},
          openResource() {},
          openExternal() {},
          noteHeader: [],
        }),
      });
      assert.equal(
        state.update({ changes: { from: 0, to: state.doc.length, insert: "replacement" } }).newDoc.toString(),
        "Preserve this text",
      );
    }
  } finally {
    lease?.release();
  }
});

test.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
])("Find toggles from document and search controls (Markdown=%s, macOS=%s)", (isMarkdown, isMacOS) => {
  installCodeMirrorDomPolyfills();
  const originalConfig = window.config;
  Object.defineProperty(window, "config", { configurable: true, writable: true, value: { isMacOS } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "apple banana apple",
      extensions: createEditorExtensions({
        isMarkdown,
        owner: "find-toggle",
        overlay: { open() {}, close() {}, hotkey() {} },
        notify() {},
        openResource() {},
        openExternal() {},
        noteHeader: [],
      }),
    }),
  });
  const shortcut = (target: HTMLElement) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        ctrlKey: !isMacOS,
        metaKey: isMacOS,
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    view.focus();
    shortcut(view.contentDOM);
    assert.equal(searchPanelOpen(view.state), true);
    const input = parent.querySelector<HTMLInputElement>('input[type="search"]')!;
    assert.equal(document.activeElement, input);
    input.value = "apple";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    assert.equal(getSearchQuery(view.state).search, "apple");
    shortcut(input);
    assert.equal(searchPanelOpen(view.state), false);
    assert.equal(parent.querySelector('input[type="search"]'), null);
    assert.equal(document.activeElement, view.contentDOM);
    shortcut(view.contentDOM);
    assert.equal(searchPanelOpen(view.state), true);
    assert.equal(getSearchQuery(view.state).search, "apple");
    // It also closes if the user moves back into the document with Find open.
    view.focus();
    shortcut(view.contentDOM);
    assert.equal(searchPanelOpen(view.state), false);
    assert.equal(document.activeElement, view.contentDOM);
    assert.equal(view.state.doc.toString(), "apple banana apple");
  } finally {
    view.destroy();
    parent.remove();
    window.config = originalConfig;
  }
});
