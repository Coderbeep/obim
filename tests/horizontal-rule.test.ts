import { test } from "vitest";

import assert from "node:assert/strict";

import { EditorState } from "@codemirror/state";

import { buildHorizontalRuleDecorations } from "../src/renderer/src/features/editor/extensions/HorizontalRuleExtension";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { fakeView, rangesFor, rangesForState, replacedTexts } from "./cm-extension-test-utils";

function horizontalRuleRanges(input: string) {
  return rangesFor(buildHorizontalRuleDecorations, input);
}

test("inactive horizontal rule replaces the whole source line with a widget", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("|\n---")), ["---"]);
});

test("inactive horizontal rule supports asterisks, underscores, and spaced markers", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("|\n***\n___\n- - -")), ["***", "___", "- - -"]);
});

test("active horizontal rule leaves the markdown source visible", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("--|-")), []);
});

test("selection touching horizontal rule leaves source visible", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("[-]--")), []);
});

test("near misses are not replaced as horizontal rules", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("|\n--\n--- text")), []);
});

test("setext underlines are not replaced as horizontal rules", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("|\nHeading\n---")), []);
});

test("inactive horizontal rules include trailing whitespace in the replacement", () => {
  assert.deepEqual(replacedTexts(horizontalRuleRanges("|\n---   ")), ["---   "]);
});

test("frontmatter fences stay separate from later horizontal rules", () => {
  const doc = "---\ntitle: Test\n---\n\nbody\n\n---";
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.indexOf("body") + 1 },
    extensions: [obimMarkdown()],
  });
  const ranges = rangesForState((view) => buildHorizontalRuleDecorations(fakeView(view.state)), state);

  assert.deepEqual(replacedTexts(ranges), ["---"]);
  assert.equal(ranges.find((range) => range.isReplace)?.from, doc.lastIndexOf("---"));
});
