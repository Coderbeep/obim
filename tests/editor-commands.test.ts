import assert from "node:assert/strict";

import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { test } from "vitest";

import { insertNewlineContinueMarkup } from "../src/renderer/src/features/editor/extensions/shared/commands";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { marked } from "./cm-extension-test-utils";

function run(command: StateCommand, input: string) {
  const { text, selection } = marked(input);
  const state = EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions: [obimMarkdown()],
  });
  const transactions: Transaction[] = [];
  const handled = command({
    state,
    dispatch: (next) => {
      transactions.push(next);
    },
  });

  return { handled, state: transactions.at(-1)?.state ?? state };
}

test("soft newline preserves ordinary line indentation", () => {
  const result = run(insertNewlineContinueMarkup, "  before|after");

  assert.equal(result.handled, true);
  assert.equal(result.state.doc.toString(), "  before\n  after");
  assert.equal(result.state.selection.main.head, "  before\n  ".length);
});

test("soft newline aligns with unordered and ordered list content", () => {
  for (const [input, expected] of [
    ["- item|", "- item\n  "],
    ["10. item|", "10. item\n    "],
    ["- parent\n    - nested|", "- parent\n    - nested\n      "],
    ["- [ ] task|", "- [ ] task\n      "],
    ["> - quoted|", "> - quoted\n>   "],
    ["- parent\n\t- tabbed|", "- parent\n\t- tabbed\n\t  "],
  ]) {
    assert.equal(run(insertNewlineContinueMarkup, input).state.doc.toString(), expected);
  }
});

test("soft newline does not replace selected text", () => {
  const result = run(insertNewlineContinueMarkup, "before [selected] after");

  assert.equal(result.handled, false);
  assert.equal(result.state.doc.toString(), "before selected after");
  assert.deepEqual({ from: result.state.selection.main.from, to: result.state.selection.main.to }, { from: 7, to: 15 });
});
