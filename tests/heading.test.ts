import { test } from "vitest";

import assert from "node:assert/strict";

import {
  buildHeadingDecorations,
  HeadingExtension,
} from "../src/renderer/src/features/editor/extensions/HeadingExtension";
import { rangesFor, rangesWithClass, replacedTexts, textsWithClass } from "./cm-extension-test-utils";

function headingRanges(input: string) {
  return rangesFor(buildHeadingDecorations, input);
}

function assertHeading(
  input: string,
  expected: { hidden?: string[]; visible?: string[]; h1?: string[]; h2?: string[] },
) {
  const ranges = headingRanges(input);

  assert.deepEqual(textsWithClass(ranges, "cm-mark-hidden"), []);
  if (expected.hidden) assert.deepEqual(replacedTexts(ranges), expected.hidden);
  if (expected.visible) assert.deepEqual(textsWithClass(ranges, "cm-formatting-heading-mark"), expected.visible);
  if (expected.h1) assert.deepEqual(textsWithClass(ranges, "cm-formatting-heading-1"), expected.h1);
  if (expected.h2) assert.deepEqual(textsWithClass(ranges, "cm-formatting-heading-2"), expected.h2);
}

test("inactive ATX heading replaces opening marker and styles the heading", () => {
  assertHeading("|\n# Summary", {
    hidden: ["# "],
    visible: [],
    h1: ["# Summary"],
  });
});

test("heading extension is only a decoration plugin, not a cursor keymap bundle", () => {
  assert.equal(Array.isArray(HeadingExtension), false);
});

test("heading fold indicator is anchored before the line content", () => {
  const indicator = headingRanges("# First\nbody|\n# Second").find((range) => range.widgetName === "HeadingFoldWidget");

  assert.equal(indicator?.from, 0);
  assert.equal(indicator?.to, 0);
});

test("caret inside ATX heading text reveals marker syntax", () => {
  assertHeading("# Sum|mary", {
    hidden: [],
    visible: ["# "],
  });
});

test("caret anywhere in ATX heading text reveals marker syntax", () => {
  for (const input of ["# |Summary", "# Sum|mary", "# Summary|"]) {
    assertHeading(input, {
      hidden: [],
      visible: ["# "],
    });
  }
});

test("caret touching ATX marker reveals marker syntax", () => {
  assertHeading("#| Summary", {
    hidden: [],
    visible: ["# "],
  });
});

test("inactive ATX heading replaces all spaces after opening marker", () => {
  assertHeading("|\n###   Spaced", {
    hidden: ["###   "],
    visible: [],
  });
});

test("inactive ATX heading replaces closing marker with surrounding spaces", () => {
  assertHeading("|\n## Summary ##", {
    hidden: ["## ", " ##"],
    h2: ["## Summary ##"],
  });
});

test("inactive ATX heading includes trailing spaces with its closing marker", () => {
  assertHeading("|\n## Summary ##   ", {
    hidden: ["## ", " ##   "],
    h2: ["## Summary ##   "],
  });
});

test("caret inside ATX heading with closing marker reveals both syntax ranges", () => {
  for (const input of ["## |Summary ##", "## Sum|mary ##", "## Summary| ##"]) {
    assertHeading(input, {
      hidden: [],
      visible: ["## ", " ##"],
    });
  }
});

test("caret touching closing ATX marker reveals opening and closing syntax", () => {
  assertHeading("## Summary #|#", {
    hidden: [],
    visible: ["## ", " ##"],
  });
});

test("selection inside ATX heading text reveals marker syntax", () => {
  assertHeading("# S[umm]ary", {
    hidden: [],
    visible: ["# "],
  });
});

test("selection spanning whole ATX heading reveals opening and closing syntax", () => {
  assertHeading("[## Summary ##]", {
    hidden: [],
    visible: ["## ", " ##"],
  });
});

test("caret in one heading does not reveal another heading", () => {
  assertHeading("# First\n# Sec|ond", {
    hidden: ["# "],
    visible: ["# "],
  });
});

for (let level = 1; level <= 6; level += 1) {
  test(`ATX heading level ${level} applies level-specific class`, () => {
    const marks = "#".repeat(level);
    assert.deepEqual(textsWithClass(headingRanges(`|\n${marks} Title`), `cm-formatting-heading-${level}`), [
      `${marks} Title`,
    ]);
  });
}

test("inactive setext heading replaces underline marker without collapsing the line", () => {
  const ranges = headingRanges("|\nSummary\n===");

  assert.deepEqual(replacedTexts(ranges), ["==="]);
  assert.equal(rangesWithClass(ranges, "cm-setext-heading-line-hidden").length, 0);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-heading-1"), ["Summary"]);
});

test("inactive setext level 2 replaces underline marker and applies h2 style", () => {
  assertHeading("|\nSummary\n---", {
    hidden: ["---"],
    visible: [],
    h2: ["Summary"],
  });
});

test("a lone dash after a paragraph remains a pending bullet instead of enlarging the paragraph", () => {
  const ranges = headingRanges("Paragraph\n- |");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-heading-2"), []);
  assert.deepEqual(textsWithClass(ranges, "cm-pending-bullet-paragraph"), ["Paragraph"]);
});

test("caret on setext underline reveals underline marker", () => {
  assertHeading("Summary\n=|==", {
    hidden: [],
    visible: ["==="],
  });
});

test("caret inside setext heading text reveals underline marker", () => {
  for (const input of ["|Summary\n===", "Sum|mary\n===", "Summary|\n==="]) {
    assertHeading(input, {
      hidden: [],
      visible: ["==="],
    });
  }
});

test("selection inside setext heading text reveals underline marker", () => {
  assertHeading("S[umm]ary\n===", {
    hidden: [],
    visible: ["==="],
  });
});

test("caret outside setext heading keeps underline hidden", () => {
  assertHeading("Summary\n===\n|after", {
    hidden: ["==="],
    visible: [],
  });
});

test("non-heading hash text does not create heading decorations", () => {
  assertHeading("|plain # hash", {
    hidden: [],
    visible: [],
  });
});

test("seven leading hashes are not treated as an ATX heading", () => {
  assertHeading("|####### Not a heading", {
    hidden: [],
    visible: [],
  });
});

test("empty ATX headings hide their marker while inactive", () => {
  assertHeading("|\n###", {
    hidden: ["###"],
    visible: [],
  });
});

test("a tab after an ATX marker remains ordinary text", () => {
  assertHeading("|\n##\tTabbed", {
    hidden: [],
    visible: [],
  });
});

test("heading-like text inside fenced and inline code is ignored", () => {
  assertHeading("|\n```md\n# fenced\n```\n`# inline`", {
    hidden: [],
    visible: [],
  });
});

test("escaped and mid-line hashes remain ordinary text", () => {
  for (const input of ["|\\# escaped", "|text # hash", "|#no-space"]) {
    assertHeading(input, { hidden: [], visible: [] });
  }
});
