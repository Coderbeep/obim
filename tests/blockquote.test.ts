import { test } from "vitest";

import assert from "node:assert/strict";

import { buildBlockQuoteDecorations } from "../src/renderer/src/features/editor/extensions/BlockQuoteExtension";
import { rangesFor, rangesWithClass, replacedTexts, textsWithClass } from "./cm-extension-test-utils";

function blockquoteRanges(input: string) {
  return rangesFor(buildBlockQuoteDecorations, input);
}

function blockquoteLineClasses(input: string) {
  return rangesWithClass(blockquoteRanges(input), "cm-blockquote-line");
}

test("inactive blockquote marks quote syntax and blockquote body", () => {
  const ranges = blockquoteRanges("|\n> quoted");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-quote-mark"), [">"]);
  assert.equal(rangesWithClass(ranges, "cm-formatting-blockquote")[0].className, "cm-formatting-blockquote");
});

test("caret inside blockquote marks the blockquote active", () => {
  const ranges = blockquoteRanges("> quo|ted");

  assert.ok(rangesWithClass(ranges, "cm-formatting-blockquote")[0].className.includes("cm-active"));
});

test("multiline blockquote decorates every quote marker and line", () => {
  const ranges = blockquoteRanges("|\n> one\n> two");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-quote-mark"), [">", ">"]);
  assert.equal(rangesWithClass(ranges, "cm-blockquote-line").length, 2);
});

test("nested blockquote depth is reflected on the line decoration and capped at four", () => {
  const lineRanges = blockquoteLineClasses("|\n> > > > > deep");

  assert.equal(lineRanges.length, 1);
  assert.ok(lineRanges[0].className.includes("cm-blockquote-depth-4"));
  assert.match(lineRanges[0].style, /padding-left: calc\(0\.9rem \+ 1\.26rem\)/);
});

test("blockquote line decoration cancels the hidden marker width without adding it to the content inset", () => {
  const lineRanges = blockquoteLineClasses("|\n> quoted");

  assert.equal(lineRanges.length, 1);
  assert.match(lineRanges[0].style, /padding-left: calc\(0\.9rem \+ 0rem\)/);
  assert.match(lineRanges[0].style, /text-indent: -2ch/);
});

test("blank quoted lines retain their structural quote marker", () => {
  const ranges = blockquoteRanges("|\n> first\n>\n> third");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-quote-mark"), [">", ">", ">"]);
  assert.equal(rangesWithClass(ranges, "cm-blockquote-line").length, 3);
});

test("lazy continuation text remains part of the blockquote without inventing a marker", () => {
  const ranges = blockquoteRanges("|\n> first\ncontinued");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-quote-mark"), [">"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-blockquote"), ["> first\ncontinued"]);
});

test("quote-looking text inside fenced code is ignored", () => {
  const ranges = blockquoteRanges("|\n```md\n> not a quote\n```");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-quote-mark"), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-blockquote"), []);
});

test("inactive note callouts replace the marker with a label widget and decorate the complete callout", () => {
  const ranges = blockquoteRanges("|\n> [!info]\n> Useful context");
  const calloutLines = rangesWithClass(ranges, "cm-callout-line");

  assert.deepEqual(replacedTexts(ranges), ["[!info]"]);
  assert.equal(ranges.find((range) => range.widgetName === "CalloutLabelWidget")?.text, "[!info]");
  assert.equal(calloutLines.length, 2);
  assert.ok(calloutLines.every((range) => range.className.includes("cm-callout-info")));
  assert.ok(calloutLines[0].className.includes("cm-callout-first"));
  assert.ok(calloutLines[1].className.includes("cm-callout-last"));
});

test("warning callouts use their semantic class case-insensitively", () => {
  const calloutLines = blockquoteLineClasses("|\n> [!WARNING]\n> Take care");

  assert.ok(calloutLines.every((range) => range.className.includes("cm-callout-warning")));
});

test("an active callout marker reveals its editable Markdown source", () => {
  const ranges = blockquoteRanges("> [!war|ning]\n> Take care");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-callout"), ["[!warning]"]);
});
