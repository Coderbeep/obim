import { test } from "vitest";

import assert from "node:assert/strict";

import { EditorState } from "@codemirror/state";
import type { StateCommand, Transaction } from "@codemirror/state";

import {
  toggleLink,
  toggleWrap,
  toggleWrapSelection,
} from "../src/renderer/src/features/editor/extensions/InlineFormattingWrap";
import { marked } from "./cm-extension-test-utils";

function stateFromMarked(input: string) {
  const { text, selection } = marked(input);
  return EditorState.create({ doc: text, selection: { anchor: selection.from, head: selection.to } });
}

function stateFromText(text: string, selection: { from: number; to: number }) {
  return EditorState.create({ doc: text, selection: { anchor: selection.from, head: selection.to } });
}

function runCommandOnState(command: StateCommand, state: EditorState) {
  const transactions: Transaction[] = [];
  const handled = command({
    state,
    dispatch: (next) => {
      transactions.push(next);
    },
  });

  assert.equal(handled, true);
  const transaction = transactions.at(-1);
  assert.ok(transaction, "command should dispatch");
  return transaction.state;
}

function runCommand(command: StateCommand, input: string) {
  return runCommandOnState(command, stateFromMarked(input));
}

function selectionText(state: EditorState) {
  const selection = state.selection.main;
  return state.doc.sliceString(selection.from, selection.to);
}

test("bold command inserts paired delimiters around an empty caret", () => {
  const state = runCommand(toggleWrap("**"), "a|b");

  assert.equal(state.doc.toString(), "a****b");
  assert.equal(state.selection.main.from, 3);
});

test("bold command wraps selected text and keeps the text selected", () => {
  const state = runCommand(toggleWrap("**"), "[text]");

  assert.equal(state.doc.toString(), "**text**");
  assert.equal(selectionText(state), "text");
});

test("bold command leaves accidentally selected surrounding whitespace outside emphasis", () => {
  const state = runCommand(toggleWrap("**"), "[\n  text  \n]");

  assert.equal(state.doc.toString(), "\n  **text**  \n");
  assert.equal(selectionText(state), "text");
});

test("bold command unwraps an already wrapped selection", () => {
  const state = runCommand(toggleWrap("**"), "**[text]**");

  assert.equal(state.doc.toString(), "text");
  assert.equal(selectionText(state), "text");
});

test("single-star command only runs when text is selected", () => {
  let dispatched = false;
  const handled = toggleWrapSelection("*")({
    state: stateFromMarked("text|"),
    dispatch: () => {
      dispatched = true;
    },
  });

  assert.equal(handled, false);
  assert.equal(dispatched, false);
  assert.equal(runCommand(toggleWrapSelection("*"), "[text]").doc.toString(), "*text*");
});

test("link command inserts an empty link and places the caret in the label", () => {
  const state = runCommand(toggleLink, "a|b");

  assert.equal(state.doc.toString(), "a[]()b");
  assert.equal(state.selection.main.from, 2);
});

test("link command wraps selected text and places the caret in the destination", () => {
  const state = runCommand(toggleLink, "[File]");

  assert.equal(state.doc.toString(), "[File]()");
  assert.equal(state.selection.main.from, "[File](".length);
});

test("link command unwraps a whole selected markdown link", () => {
  const link = "[File](note.md)";
  const state = runCommandOnState(toggleLink, stateFromText(link, { from: 0, to: link.length }));

  assert.equal(state.doc.toString(), "File");
  assert.equal(selectionText(state), "File");
});

test("link command unwraps a selected link label inside existing link syntax", () => {
  const state = runCommandOnState(toggleLink, stateFromText("[File](note.md)", { from: 1, to: 5 }));

  assert.equal(state.doc.toString(), "File");
  assert.equal(selectionText(state), "File");
});

test.each([
  "[File](drafts/(old)/note.md)",
  '[File](<Draft notes/note.md> "A title")',
  String.raw`[File](drafts/old\(copy\).md 'A title')`,
])("link command unwraps complete Markdown destination grammar: %s", (link) => {
  const state = runCommandOnState(toggleLink, stateFromText(link, { from: 0, to: link.length }));

  assert.equal(state.doc.toString(), "File");
  assert.equal(selectionText(state), "File");
});

test("link command unwraps a selected label with a nested-parenthesis destination", () => {
  const link = "Before [File](drafts/(old)/note.md) after";
  const from = link.indexOf("File");
  const state = runCommandOnState(toggleLink, stateFromText(link, { from, to: from + "File".length }));

  assert.equal(state.doc.toString(), "Before File after");
  assert.equal(selectionText(state), "File");
});
