import { test } from "vitest";

import assert from "node:assert/strict";

import {
  buildLinkDecorations,
  getLinkOverlayState,
} from "../src/renderer/src/features/editor/extensions/LinkExtension";
import {
  rangesFor,
  rangesForState,
  markdownStateFromText,
  replacedTexts,
  textsWithClass,
} from "./cm-extension-test-utils";

function linkRanges(input: string) {
  return rangesFor(buildLinkDecorations, input);
}

function linkRangesFromText(text: string, selection: { from: number; to: number }) {
  return rangesForState(buildLinkDecorations, markdownStateFromText(text, selection));
}

function assertLinkClasses(
  input: string,
  expected: { syntax?: string[]; text?: string[]; target?: string[]; replaced?: string[] },
) {
  const ranges = linkRanges(input);

  if (expected.syntax) assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-mark"), expected.syntax);
  if (expected.text) assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-text"), expected.text);
  if (expected.target) assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-target"), expected.target);
  if (expected.replaced) assert.deepEqual(replacedTexts(ranges), expected.replaced);
}

test("inactive internal link replaces the whole markdown source with one widget", () => {
  assertLinkClasses("|\n[File](Notes/File.md)", {
    replaced: ["[File](Notes/File.md)"],
    syntax: [],
    text: [],
    target: [],
  });
});

test("inactive external link replaces the whole markdown source with one widget", () => {
  assertLinkClasses("|\n[OpenAI](https://openai.com)", {
    replaced: ["[OpenAI](https://openai.com)"],
    syntax: [],
    text: [],
    target: [],
  });
});

test("active link text shows brackets, destination syntax, label text, and target", () => {
  assertLinkClasses("[Fi|le](Notes/File.md)", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Notes/File.md"],
    replaced: [],
  });
});

test("active link destination shows brackets, destination syntax, label text, and target", () => {
  assertLinkClasses("[File](Notes/Fi|le.md)", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Notes/File.md"],
    replaced: [],
  });
});

test("caret before link opening keeps full link syntax visible", () => {
  assertLinkClasses("|[File](Notes/File.md)", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Notes/File.md"],
    replaced: [],
  });
});

test("caret after link closing keeps full link syntax visible", () => {
  assertLinkClasses("[File](Notes/File.md)|", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Notes/File.md"],
    replaced: [],
  });
});

test("selection overlapping link label keeps full link syntax visible", () => {
  const ranges = linkRangesFromText("[File](Notes/File.md)", { from: 2, to: 4 });

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-mark"), ["[", "](", ")"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-text"), ["File"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-link-target"), ["Notes/File.md"]);
  assert.deepEqual(replacedTexts(ranges), []);
});

test("active empty-label link omits empty text decoration but still shows target", () => {
  assertLinkClasses("[](Not|es/File.md)", {
    syntax: ["[", "](", ")"],
    text: [],
    target: ["Notes/File.md"],
    replaced: [],
  });
});

test("active angled link shows angle brackets as syntax and excludes them from target", () => {
  assertLinkClasses("[File](<Notes/My |File.md>)", {
    syntax: ["[", "](", "<", ">", ")"],
    text: ["File"],
    target: ["Notes/My File.md"],
    replaced: [],
  });
});

test("inactive link with spaces in destination uses fallback parser and replaces full source", () => {
  assertLinkClasses("|\n[File](Notes/My File.md)", {
    replaced: ["[File](Notes/My File.md)"],
  });
});

test("active link with spaces in destination uses fallback parser and decorates target", () => {
  assertLinkClasses("[File](Notes/My |File.md)", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Notes/My File.md"],
    replaced: [],
  });
});

test("active link with escaped and nested parentheses decorates the raw target text", () => {
  assertLinkClasses("[File](Draft \\(old\\) (copy)|.md)", {
    syntax: ["[", "](", ")"],
    text: ["File"],
    target: ["Draft \\(old\\) (copy).md"],
    replaced: [],
  });
});

test("multiple inactive links each get their own replacement", () => {
  assertLinkClasses("|\n[One](one.md) and [Two](two.md)", {
    replaced: ["[One](one.md)", "[Two](two.md)"],
  });
});

test("syntax and fallback links on one line each receive one replacement", () => {
  assertLinkClasses("|\n[One](one.md) and [Spaced](my file.md)", {
    replaced: ["[One](one.md)", "[Spaced](my file.md)"],
  });
});

test("active first link does not replace inactive second link incorrectly", () => {
  assertLinkClasses("[On|e](one.md) and [Two](two.md)", {
    syntax: ["[", "](", ")"],
    text: ["One"],
    target: ["one.md"],
    replaced: ["[Two](two.md)"],
  });
});

test("escaped link syntax is ignored", () => {
  assertLinkClasses("|\\[File](Notes/File.md)", {
    replaced: [],
    syntax: [],
    text: [],
    target: [],
  });
});

test("unclosed link syntax is ignored", () => {
  assertLinkClasses("|[File](Notes/File.md", {
    replaced: [],
    syntax: [],
    text: [],
    target: [],
  });
});

test("image markdown is not treated as a plain link", () => {
  assertLinkClasses("|![Alt](image.png)", {
    replaced: [],
    syntax: [],
    text: [],
    target: [],
  });
});

test("link-looking text inside inline and fenced code is ignored", () => {
  assertLinkClasses("|`[inline](note.md)`\n```md\n[block](note.md)\n```", {
    replaced: [],
    syntax: [],
    text: [],
    target: [],
  });
});

test("reference-style links remain ordinary markdown", () => {
  assertLinkClasses("|[label][reference]\n\n[reference]: note.md", {
    replaced: [],
    syntax: [],
    text: [],
    target: [],
  });
});

test("link overlay state is active only when caret is inside link destination", () => {
  const targetState = markdownStateFromText("[File](note.md)", { from: 10, to: 10 });
  assert.deepEqual(getLinkOverlayState(targetState, targetState.selection.main), {
    caretInside: true,
    activePos: [7, 14],
    anchorPos: 7,
    currentSrc: "note.md",
  });

  const labelState = markdownStateFromText("[File](note.md)", { from: 2, to: 2 });
  assert.deepEqual(getLinkOverlayState(labelState, labelState.selection.main), {
    caretInside: false,
    activePos: [7, 14],
    anchorPos: 7,
    currentSrc: "note.md",
  });

  const outsideState = markdownStateFromText("text", { from: 2, to: 2 });
  assert.deepEqual(getLinkOverlayState(outsideState, outsideState.selection.main), {
    caretInside: false,
    activePos: null,
    anchorPos: null,
    currentSrc: "",
  });
});

test("link overlay state uses fallback parser for destinations with spaces", () => {
  const state = markdownStateFromText("[File](my file.md)", { from: 11, to: 11 });

  assert.deepEqual(getLinkOverlayState(state, state.selection.main), {
    caretInside: true,
    activePos: [7, 17],
    anchorPos: 7,
    currentSrc: "my file.md",
  });
});

test("link overlay state stays disabled for selections crossing a link", () => {
  const doc = "[File](note.md)";
  const editableState = markdownStateFromText(doc, { from: 10, to: 10 });
  const empty = { caretInside: false, activePos: null, anchorPos: null, currentSrc: "" };

  assert.deepEqual(getLinkOverlayState(editableState, { from: 10, to: doc.length + 1 }), empty);
});
