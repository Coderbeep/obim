import { test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";

import {
  buildEmphasisDecorations,
  EmphasisExtension,
} from "../src/renderer/src/features/editor/extensions/EmphasisExtension";
import {
  rangesFor,
  rangesForState,
  rangesWithClass,
  replacedTexts,
  sortedTexts,
  textsWithClass,
} from "./cm-extension-test-utils";

function emphasisRanges(input: string) {
  return rangesFor(buildEmphasisDecorations, input);
}

function assertEmphasis(
  input: string,
  expected: { hidden?: string[]; visible?: string[]; bold?: string[]; italic?: string[] },
) {
  const ranges = emphasisRanges(input);

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  if (expected.hidden) assert.deepEqual(sortedTexts(replacedTexts(ranges)), sortedTexts(expected.hidden));
  if (expected.visible)
    assert.deepEqual(sortedTexts(textsWithClass(ranges, "cm-formatting-emphasis-mark")), sortedTexts(expected.visible));
  if (expected.bold) assert.deepEqual(textsWithClass(ranges, "cm-formatting-bold-text"), expected.bold);
  if (expected.italic) assert.deepEqual(textsWithClass(ranges, "cm-formatting-italic-text"), expected.italic);
}

test("inactive emphasis replaces delimiter syntax and styles only content", () => {
  assertEmphasis("|\n**Bold** and *italic*", {
    hidden: ["**", "**", "*", "*"],
    visible: [],
    bold: ["Bold"],
    italic: ["italic"],
  });
});

test("emphasis extension is only a decoration plugin, not a cursor keymap bundle", () => {
  assert.equal(Array.isArray(EmphasisExtension), false);
});

test("inactive delimiter variants are replaced", () => {
  assertEmphasis("|\n*one* _two_ **three** __four__", {
    hidden: ["*", "*", "_", "_", "**", "**", "__", "__"],
    visible: [],
    italic: ["one", "two"],
    bold: ["three", "four"],
  });
});

test("caret inside strong content reveals both delimiters", () => {
  assertEmphasis("**Bo|ld** and *italic*", {
    hidden: ["*", "*"],
    visible: ["**", "**"],
  });
});

test("caret inside italic content reveals both delimiters", () => {
  assertEmphasis("**Bold** and *ita|lic*", {
    hidden: ["**", "**"],
    visible: ["*", "*"],
  });
});

test("strong delimiter boundary carets reveal both delimiters", () => {
  for (const input of ["|**Bold**", "**|Bold**", "**Bold|**", "**Bold**|"]) {
    assertEmphasis(input, {
      hidden: [],
      visible: ["**", "**"],
    });
  }
});

test("italic delimiter boundary carets reveal both delimiters", () => {
  for (const input of ["|_Italic_", "_|Italic_", "_Italic|_", "_Italic_|"]) {
    assertEmphasis(input, {
      hidden: [],
      visible: ["_", "_"],
    });
  }
});

test("selection inside emphasized content reveals both delimiters", () => {
  assertEmphasis("**B[ol]d** and *italic*", {
    hidden: ["*", "*"],
    visible: ["**", "**"],
  });
});

test("caret touching opening delimiter reveals both delimiters for that emphasis span", () => {
  assertEmphasis("**|Bold**", {
    hidden: [],
    visible: ["**", "**"],
  });
});

test("caret in one sibling emphasis span does not reveal the other", () => {
  assertEmphasis("**Bo|ld** and *italic*", {
    hidden: ["*", "*"],
    visible: ["**", "**"],
  });
  assertEmphasis("**Bold** and *ita|lic*", {
    hidden: ["**", "**"],
    visible: ["*", "*"],
  });
});

test("multiple cursors reveal every touched emphasis span", () => {
  const text = "**first** and *second* and _third_";
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.create([
      EditorSelection.cursor(text.indexOf("first") + 2),
      EditorSelection.cursor(text.indexOf("second") + 2),
    ]),
    extensions: [markdown({ base: markdownLanguage }), EditorState.allowMultipleSelections.of(true)],
  });
  const ranges = rangesForState(buildEmphasisDecorations, state);

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-emphasis-mark"), ["**", "**", "*", "*"]);
  assert.deepEqual(replacedTexts(ranges), ["_", "_"]);
});

test("selection crossing delimiters reveals touched delimiters", () => {
  assertEmphasis("[**Bold**] and *italic*", {
    hidden: ["*", "*"],
    visible: ["**", "**"],
  });
});

test("selection overlapping one side reveals both delimiters for that span", () => {
  assertEmphasis("before [**Bo]ld** after", {
    hidden: [],
    visible: ["**", "**"],
  });
  assertEmphasis("before **Bo[ld** af]ter", {
    hidden: [],
    visible: ["**", "**"],
  });
});

test("nested emphasis hides all untouched delimiters", () => {
  assertEmphasis("|\n***both***", {
    hidden: ["*", "**", "**", "*"],
    visible: [],
  });
});

test("caret in outer nested emphasis reveals parent delimiters only", () => {
  assertEmphasis("**a |b _c_ d**", {
    hidden: ["_", "_"],
    visible: ["**", "**"],
  });
});

test("caret in inner nested emphasis reveals parent and child delimiters", () => {
  assertEmphasis("**a b _|c_ d**", {
    hidden: [],
    visible: ["**", "_", "_", "**"],
  });
});

test("caret inside triple-star emphasis reveals every delimiter segment", () => {
  assertEmphasis("***bo|th***", {
    hidden: [],
    visible: ["*", "**", "**", "*"],
  });
});

test("multiline emphasis hides inactive delimiters and reveals them when active", () => {
  assertEmphasis("|\n*hello\nworld*", {
    hidden: ["*", "*"],
    visible: [],
  });
  assertEmphasis("*hello\nwor|ld*", {
    hidden: [],
    visible: ["*", "*"],
  });
});

test("intraword underscore delimiters do not create emphasis decorations", () => {
  const ranges = emphasisRanges("|foo_bar_baz");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(rangesWithClass(ranges, "cm-formatting-emphasis-mark"), []);
  assert.deepEqual(rangesWithClass(ranges, "cm-formatting-italic-text"), []);
});

test("unclosed or escaped delimiters do not create emphasis decorations", () => {
  assertEmphasis("|**not closed", { hidden: [], visible: [], bold: [], italic: [] });
  assertEmphasis("|\\*literal\\*", { hidden: [], visible: [], bold: [], italic: [] });
});

test("emphasis-looking text inside inline and fenced code is ignored", () => {
  assertEmphasis("|`**inline**`\n```md\n*block*\n```", {
    hidden: [],
    visible: [],
    bold: [],
    italic: [],
  });
});
