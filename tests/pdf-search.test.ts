import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createPdfPageTextIndex,
  createPdfTextItemAdvanceMaps,
  findPdfPageTextMatches,
  normalizePdfSearchQuery,
  pdfTextItemMatchGeometry,
} from "../src/renderer/src/features/files/pdfSearch";

test("PDF search normalizes whitespace while retaining exact item offsets", () => {
  const index = createPdfPageTextIndex([
    { str: "Quarterly", width: 48, height: 10, transform: [10, 0, 0, 10, 10, 100] },
    { str: "report", width: 30, height: 10, transform: [10, 0, 0, 10, 62, 100], hasEOL: true },
    { str: "Revenue\tgrew", width: 62, height: 10, transform: [10, 0, 0, 10, 10, 80] },
  ]);

  assert.equal(index.text, "Quarterly report Revenue grew");
  assert.equal(normalizePdfSearchQuery("  revenue   grew  "), "revenue grew");

  const matches = findPdfPageTextMatches(index, "REPORT revenue");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].itemRanges, [
    { itemIndex: 1, start: 0, end: 6 },
    { itemIndex: 2, start: 0, end: 7 },
  ]);
});

test("PDF search does not invent spaces when styled text items touch", () => {
  const index = createPdfPageTextIndex([
    { str: "inter", width: 20, height: 10, transform: [10, 0, 0, 10, 10, 100] },
    { str: "national", width: 32, height: 10, transform: [10, 0, 0, 10, 30, 100] },
  ]);

  assert.equal(index.text, "international");
  const [match] = findPdfPageTextMatches(index, "NATIONAL");
  assert.deepEqual(match.itemRanges, [{ itemIndex: 1, start: 0, end: 8 }]);
});

test("PDF search treats regular-expression characters literally", () => {
  const index = createPdfPageTextIndex([{ str: "Use value.* and value+ in examples." }]);
  assert.equal(findPdfPageTextMatches(index, "value.*").length, 1);
  assert.equal(findPdfPageTextMatches(index, "value+").length, 1);
});

test("PDF search adds Unicode-compatible matches without losing literal matches", () => {
  const index = createPdfPageTextIndex([{ str: "Itô Fokker–Planck ﬁeld Fokker-Planck" }]);

  assert.equal(normalizePdfSearchQuery("Itô"), "Ito");
  assert.equal(normalizePdfSearchQuery("Fokker–Planck"), "Fokker-Planck");
  assert.equal(findPdfPageTextMatches(index, "Ito").length, 1);
  assert.equal(findPdfPageTextMatches(index, "Itô").length, 1);
  assert.equal(findPdfPageTextMatches(index, "Fokker-Planck").length, 2);
  assert.equal(findPdfPageTextMatches(index, "ﬁeld").length, 1);
  assert.equal(findPdfPageTextMatches(index, "field").length, 1);
});

test("PDF search joins line-end hyphenation while preserving the literal representation", () => {
  const index = createPdfPageTextIndex([{ str: "significant vari-", hasEOL: true }, { str: "ability remains" }]);

  const [joinedMatch] = findPdfPageTextMatches(index, "variability");
  assert.deepEqual(joinedMatch.itemRanges, [
    { itemIndex: 0, start: 12, end: 16 },
    { itemIndex: 1, start: 0, end: 7 },
  ]);
  assert.equal(findPdfPageTextMatches(index, "vari- ability").length, 1);
});

test("PDF search geometry follows glyph advances inside combined dotted-leader items", () => {
  const text = "The Logistic Model . . .";
  const glyph = (unicode: string, width: number) => ({ unicode, width });
  const entries = [
    glyph("T", 722),
    glyph("h", 556),
    glyph("e", 444),
    -333,
    glyph("L", 625),
    glyph("o", 500),
    glyph("g", 500),
    glyph("i", 278),
    glyph("s", 394),
    glyph("t", 389),
    glyph("i", 278),
    glyph("c", 444),
    -333,
    glyph("M", 917),
    glyph("o", 500),
    -28,
    glyph("d", 556),
    glyph("e", 444),
    glyph("l", 278),
    -468.8,
    glyph(".", 278),
    -499,
    glyph(".", 278),
    -500,
    glyph(".", 278),
  ];
  const [map] = createPdfTextItemAdvanceMaps([{ str: text }], { fnArray: [44], argsArray: [[entries]] }, new Set([44]));

  assert.ok(map);
  const matchStart = text.indexOf("Model");
  const matchEnd = matchStart + "Model".length;
  assert.equal(map.starts[matchStart], 5796);
  assert.equal(map.ends[matchEnd - 1], 8519);
  assert.ok(map.ends[matchEnd - 1] < map.starts[text.indexOf(".")]);
});

test("PDF search geometry maps a TOC heading when leader dots use a separate text operator", () => {
  const text = "Models . . .";
  const glyphs = (value: string, width: number) => Array.from(value, (unicode) => ({ unicode, width }));
  const [map] = createPdfTextItemAdvanceMaps(
    [
      {
        str: text,
        fontName: "regular",
        width: 60,
        transform: [10, 0, 0, 10, 0, 0],
      },
    ],
    {
      fnArray: [37, 44, 37, 44, 44],
      argsArray: [
        ["bold", 10],
        [glyphs("Models", 700)],
        ["regular", 10],
        [glyphs("Models", 500)],
        [glyphs(". . .", 250)],
      ],
    },
    new Set([44]),
    37,
  );

  assert.ok(map);
  assert.equal(map.ends["Models".length - 1] - map.starts[0], 3000);
  assert.ok(Number.isNaN(map.starts[text.indexOf(".")]));
  assert.deepEqual(pdfTextItemMatchGeometry(map, 0, "Models".length), {
    startFraction: 0,
    endFraction: 0.5,
  });
});

test("PDF search rejects non-monotonic table glyph geometry", () => {
  const glyph = (unicode: string) => ({ unicode, width: 500 });
  const entries = [glyph("1"), 1000, glyph("3"), 1000, glyph("0"), 1000, glyph("."), 1000, glyph("0")];
  const [map] = createPdfTextItemAdvanceMaps(
    [{ str: "130.0", dir: "ltr", fontName: "table", width: 20, transform: [8, 0, 0, 8, 0, 0] }],
    { fnArray: [37, 44], argsArray: [["table", 8], [entries]] },
    new Set([44]),
    37,
  );

  assert.equal(map, null);
});

test("PDF search falls back when mapped fractions leave the text item", () => {
  assert.equal(
    pdfTextItemMatchGeometry(
      {
        starts: Float64Array.from([0, 1]),
        ends: Float64Array.from([1, 5]),
        itemStart: 0,
        itemEnd: 2,
      },
      0,
      2,
    ),
    null,
  );
});
