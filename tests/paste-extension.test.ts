import { test } from "vitest";

import assert from "node:assert/strict";

import {
  buildPastedImagePath,
  csvTextToMarkdownTable,
  parseCsvRows,
} from "../src/renderer/src/features/editor/extensions/PasteExtension";
import { imageExtensionFromMimeType } from "../src/shared/mime-types";

test("csv paste converts rows to a padded markdown table", () => {
  assert.equal(csvTextToMarkdownTable("Name,Age\nAda,36"), "| Name | Age |\n| ---- | --- |\n| Ada  | 36  |");
});

test("csv parser handles quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsvRows('Name,Note\n"Ada, Lovelace","uses ""quotes"""'), [
    ["Name", "Note"],
    ["Ada, Lovelace", 'uses "quotes"'],
  ]);
});

test("csv parser rejects an unterminated quoted field", () => {
  assert.equal(parseCsvRows('Name,Note\nAda,"unfinished'), null);
  assert.equal(csvTextToMarkdownTable('Name,Note\nAda,"unfinished'), null);
});

test("csv parser accepts CRLF, bare carriage returns, and trailing blank records", () => {
  assert.deepEqual(parseCsvRows("A,B\r\n1,2\r\n\r\n"), [
    ["A", "B"],
    ["1", "2"],
  ]);
  assert.deepEqual(parseCsvRows("A,B\r1,2"), [
    ["A", "B"],
    ["1", "2"],
  ]);
  assert.deepEqual(parseCsvRows(""), []);
});

test("plain text paste is not treated as csv", () => {
  assert.equal(csvTextToMarkdownTable("just a sentence, with a comma"), null);
  assert.equal(csvTextToMarkdownTable("first line, with comma\nsecond line"), null);
});

test("markdown table cells escape pipes and preserve embedded newlines", () => {
  assert.equal(
    csvTextToMarkdownTable('Name,Note\nAda,"first\nsecond | value"'),
    "| Name | Note                     |\n| ---- | ------------------------ |\n| Ada  | first<br>second \\| value |",
  );
});

test("markdown tables pad short data rows to the header width", () => {
  assert.equal(csvTextToMarkdownTable("A,B,C\n1,2"), "| A   | B   | C   |\n| --- | --- | --- |\n| 1   | 2   |     |");
});

test("pasted image paths use supported mime extensions", () => {
  assert.equal(imageExtensionFromMimeType("image/avif"), "avif");
  assert.equal(imageExtensionFromMimeType("image/bmp"), "bmp");
  assert.equal(imageExtensionFromMimeType("image/jpeg"), "jpg");
  assert.equal(imageExtensionFromMimeType("image/vnd.microsoft.icon"), "ico");
  assert.equal(buildPastedImagePath("image/png", "abc"), "attachments/pasted-image-abc.png");
  assert.equal(buildPastedImagePath("image/tiff", "abc"), null);
});
