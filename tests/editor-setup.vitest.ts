import { createStore } from "jotai";
import assert from "node:assert/strict";
import { beginWorkspaceTransition } from "../src/renderer/src/store/workspaceTransitionStore";

import { deleteCharBackward, toggleComment } from "@codemirror/commands";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
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
