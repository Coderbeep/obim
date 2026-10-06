import { test } from "vitest";

import assert from "node:assert/strict";

import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import {
  CodeBlockExtension,
  buildCodeBlockDecorations,
  resolveCodeBlockIconData,
} from "../src/renderer/src/features/editor/extensions/CodeBlockExtension";
import { obimMarkdown, resolveMarkdownCodeLanguage } from "../src/renderer/src/features/editor/language";
import {
  markdownStateFromText,
  rangesFor,
  rangesWithClass,
  replacedTexts,
  textsWithClass,
  type DecorationRange,
} from "./cm-extension-test-utils";
import type { EditorView } from "@codemirror/view";

function codeRanges(input: string) {
  return rangesFor(buildCodeBlockDecorations, input);
}

test("typing an HTML opener does not offer tag hints", () => {
  const state = EditorState.create({ doc: "<", selection: { anchor: 1 }, extensions: [obimMarkdown()] });

  assert.deepEqual(state.languageDataAt("autocomplete", 1), []);
});

function assertInlineCode(
  input: string,
  expected: { replaced?: string[]; mark?: string[]; text?: string[]; wrapper?: string[] },
) {
  const ranges = codeRanges(input);

  if (expected.replaced) assert.deepEqual(replacedTexts(ranges), expected.replaced);
  if (expected.mark) assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-mark"), expected.mark);
  if (expected.text) assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-text"), expected.text);
  if (expected.wrapper) assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code"), expected.wrapper);
  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
}

function lineClasses(ranges: DecorationRange[], className: string) {
  return rangesWithClass(ranges, className).map((range) => range.className);
}

function codeLineNumbers(doc: string) {
  const state = markdownStateFromText(doc, { from: 0, to: 0 });
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
  const markers: { line: number; number: number; quoted: boolean }[] = [];

  buildCodeBlockDecorations(view).between(0, state.doc.length, (from, _to, value) => {
    const number = value.spec.attributes?.["data-code-line-number"];
    if (number === undefined) return;

    markers.push({
      line: state.doc.lineAt(from).number,
      number: Number(number),
      quoted: value.spec.attributes?.["data-code-line-number-quoted"] === "true",
    });
  });

  return markers;
}

test("inactive inline code hides both backtick marks and styles only code text", () => {
  assertInlineCode("|\n`Summary`", {
    replaced: ["`", "`"],
    mark: [],
    text: ["Summary"],
    wrapper: ["`Summary`"],
  });
});

test("code block extension is only a decoration plugin, not an inline cursor keymap bundle", () => {
  assert.equal(Array.isArray(CodeBlockExtension), false);
});

test("active inline code shows both backtick marks", () => {
  assertInlineCode("`Sum|mary`", {
    replaced: [],
    mark: ["`", "`"],
    text: ["Summary"],
    wrapper: ["`Summary`"],
  });
});

test("caret at inline code boundaries keeps backtick syntax visible", () => {
  for (const input of ["|`Summary`", "`|Summary`", "`Summary|`", "`Summary`|"]) {
    assertInlineCode(input, {
      replaced: [],
      mark: ["`", "`"],
    });
  }
});

test("selection inside inline code keeps both backtick marks visible", () => {
  assertInlineCode("`Su[mm]ary`", {
    replaced: [],
    mark: ["`", "`"],
  });
});

test("selection crossing one inline code delimiter reveals both delimiters for that span", () => {
  assertInlineCode("[`Sum]mary`", {
    replaced: [],
    mark: ["`", "`"],
  });
});

test("caret in one inline code span does not reveal sibling span delimiters", () => {
  const ranges = codeRanges("`one` and `t|wo`");

  assert.deepEqual(replacedTexts(ranges), ["`", "`"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-mark"), ["`", "`"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-text"), ["one", "two"]);
});

test("inactive double-backtick inline code hides double-backtick marks", () => {
  assertInlineCode("|\n``code with ` tick``", {
    replaced: ["``", "``"],
    mark: [],
    text: ["code with ` tick"],
  });
});

test("active double-backtick inline code shows double-backtick marks", () => {
  assertInlineCode("``code with ` |tick``", {
    replaced: [],
    mark: ["``", "``"],
    text: ["code with ` tick"],
  });
});

test("unclosed inline code does not create inline code decorations", () => {
  assertInlineCode("|`not closed", {
    replaced: [],
    mark: [],
    text: [],
    wrapper: [],
  });
});

test("inactive fenced code replaces opening fence with language widget", () => {
  const ranges = codeRanges("|\n```ts\ncode\n```");

  assert.deepEqual(replacedTexts(ranges), ["```ts"]);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-begin").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-end").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line").length, 1);
});

test("code block icon resolver uses aliases, first info token, and fallback", () => {
  assert.strictEqual(resolveCodeBlockIconData("ts"), resolveCodeBlockIconData("typescript"));
  assert.strictEqual(resolveCodeBlockIconData("python title=test"), resolveCodeBlockIconData("python"));
  assert.strictEqual(resolveCodeBlockIconData("not-a-language"), resolveCodeBlockIconData(""));
});

test("code block language resolver accepts file-extension shortcuts", () => {
  assert.equal(resolveMarkdownCodeLanguage(languages, "py")?.name, "Python");
  assert.equal(resolveMarkdownCodeLanguage(languages, "rs")?.name, "Rust");
  assert.equal(resolveMarkdownCodeLanguage(languages, "tsx")?.name, "TSX");
});

test("fenced code line numbers belong to their content lines only", () => {
  assert.deepEqual(codeLineNumbers("```ts\none\ntwo\n```"), [
    { line: 2, number: 1, quoted: false },
    { line: 3, number: 2, quoted: false },
  ]);
});

test("code line numbers support unclosed fences and empty visible ranges", () => {
  assert.deepEqual(codeLineNumbers("```ts\none\ntwo"), [
    { line: 2, number: 1, quoted: false },
    { line: 3, number: 2, quoted: false },
  ]);

  const state = markdownStateFromText("```ts\none\n```", { from: 0, to: 0 });
  const view = { state, visibleRanges: [] } as unknown as EditorView;
  assert.equal(buildCodeBlockDecorations(view).size, 0);
});

test("fenced code line decorations skip folded visible-range gaps", () => {
  const state = markdownStateFromText("```ts\none\ntwo\nthree\n```", { from: 0, to: 0 });
  const first = state.doc.line(1);
  const last = state.doc.line(5);
  const view = {
    state,
    visibleRanges: [
      { from: first.from, to: first.to },
      { from: last.from, to: last.to },
    ],
  } as unknown as EditorView;
  const decoratedLines: number[] = [];

  buildCodeBlockDecorations(view).between(0, state.doc.length, (from, _to, value) => {
    if (value.spec.class?.includes("cm-formatting-codeblock-line")) {
      decoratedLines.push(state.doc.lineAt(from).number);
    }
  });

  assert.deepEqual(decoratedLines, [1, 5]);
});

test("indented code lines are numbered from one", () => {
  assert.deepEqual(codeLineNumbers("    one\n    two"), [
    { line: 1, number: 1, quoted: false },
    { line: 2, number: 2, quoted: false },
  ]);
});

test("literal quote markers inside indented code do not shift line numbers", () => {
  assert.deepEqual(codeLineNumbers("    > quoted\n    plain"), [
    { line: 1, number: 1, quoted: false },
    { line: 2, number: 2, quoted: false },
  ]);
});

test("quoted fenced code numbers carry their visual-offset attribute", () => {
  assert.deepEqual(codeLineNumbers("> ```ts\n> one\n> ```"), [{ line: 2, number: 1, quoted: true }]);
});

test("literal quote markers inside fenced code do not shift line numbers", () => {
  assert.deepEqual(codeLineNumbers("```markdown\n# Notes\n> [!pdf-ref] Source\n> quoted text\nplain text\n```"), [
    { line: 2, number: 1, quoted: false },
    { line: 3, number: 2, quoted: false },
    { line: 4, number: 3, quoted: false },
    { line: 5, number: 4, quoted: false },
  ]);
});

test("active fenced code keeps opening fence visible and marks block lines active", () => {
  const ranges = codeRanges("```|ts\ncode\n```");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.ok(
    lineClasses(ranges, "cm-formatting-codeblock-line-begin").every((className) => className.includes("active")),
  );
  assert.ok(lineClasses(ranges, "cm-formatting-codeblock-line-end").every((className) => className.includes("active")));
});

test("caret on fenced code closing line keeps fenced block active", () => {
  const ranges = codeRanges("```ts\ncode\n`|``");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.ok(
    lineClasses(ranges, "cm-formatting-codeblock-line-begin").every((className) => className.includes("active")),
  );
  assert.ok(lineClasses(ranges, "cm-formatting-codeblock-line-end").every((className) => className.includes("active")));
});

test("inactive fenced code without language replaces bare opening fence", () => {
  assert.deepEqual(replacedTexts(codeRanges("|\n```\ncode\n```")), ["```"]);
});

test("inactive four-backtick fenced code replaces four-backtick opening fence", () => {
  assert.deepEqual(replacedTexts(codeRanges("|\n````\ncode\n````")), ["````"]);
});

test("single-line fenced code gets single-line block decoration", () => {
  const ranges = codeRanges("|\n```");

  assert.deepEqual(replacedTexts(ranges), ["```"]);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-single").length, 1);
});

test("indented code block applies begin, middle, and end line classes", () => {
  const ranges = codeRanges("|\n    one\n    two\n    three");

  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-content-begin").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-unclosed-end").length, 1);
});

test("one-line indented code block gets single-line content classes", () => {
  const ranges = codeRanges("|\n    one");

  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-content-begin").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-unclosed-end").length, 1);
});

test("inactive tilde fences use the same language widget and line styling", () => {
  const ranges = codeRanges("|\n~~~ts\ncode\n~~~");

  assert.deepEqual(replacedTexts(ranges), ["~~~ts"]);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-begin").length, 1);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-end").length, 1);
});

test("selection crossing a fenced block keeps both fence lines active", () => {
  const ranges = codeRanges("[```ts\ncode\n```]");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.ok(
    lineClasses(ranges, "cm-formatting-codeblock-line-begin").every((className) => className.includes("active")),
  );
  assert.ok(lineClasses(ranges, "cm-formatting-codeblock-line-end").every((className) => className.includes("active")));
});

test("a longer closing fence still closes and styles the fenced block", () => {
  const ranges = codeRanges("|\n```ts\ncode\n````");

  assert.deepEqual(replacedTexts(ranges), ["```ts"]);
  assert.equal(lineClasses(ranges, "cm-formatting-codeblock-line-end").length, 1);
});

test("inline code preserves spaces and embedded delimiter characters as content", () => {
  assertInlineCode("|\n`` code ` value ``", {
    replaced: ["``", "``"],
    text: [" code ` value "],
  });
});

test("inline-code-looking text inside fenced code is not decorated twice", () => {
  const ranges = codeRanges("|\n```md\n`not inline`\n```");

  assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-mark"), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-inline-code-text"), []);
});
