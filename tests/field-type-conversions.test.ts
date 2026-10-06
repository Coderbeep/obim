import assert from "node:assert/strict";

import { describe, test } from "vitest";

import { convertFieldValue } from "../src/renderer/src/features/editor/note-details/fields/fieldTypeConversions";
import { initialFieldValue } from "../src/renderer/src/features/editor/note-details/fields/fieldTypes";
import { editFrontmatterSource, parseFrontmatter, type FrontmatterValue } from "../src/shared/frontmatter";
import { frontmatterFieldType, type SupportedFrontmatterFieldType } from "../src/shared/frontmatter-fields";

const value = (source: string): FrontmatterValue => {
  const parsed = parseFrontmatter(`---\nvalue: ${source}\n---\n`);
  assert.equal(parsed.kind, "valid");
  return parsed.properties[0]!.value;
};

const types: SupportedFrontmatterFieldType[] = ["text", "number", "boolean", "list", "date", "datetime"];
const samples: Record<SupportedFrontmatterFieldType, FrontmatterValue> = {
  text: value('"42"'),
  number: value("1e3"),
  boolean: value("true"),
  list: value('["42"]'),
  date: value("2026-07-31"),
  datetime: value("2026-07-31T12:34:56Z"),
};

describe("field type conversion policy", () => {
  test("covers the complete six-by-six availability matrix", () => {
    const expected: Record<SupportedFrontmatterFieldType, SupportedFrontmatterFieldType[]> = {
      text: ["text", "list"],
      number: ["text", "number", "list"],
      boolean: ["text", "boolean", "list"],
      list: ["text", "list"],
      date: ["text", "list", "date", "datetime"],
      datetime: ["text", "list", "datetime"],
    };

    for (const source of types) {
      assert.deepEqual(
        types.filter((target) => target === source || convertFieldValue(samples[source], target) !== undefined),
        expected[source],
      );
    }
  });

  test("changes empty text and lists to any target without data loss", () => {
    const today = new Date("2026-08-02T12:00:00.000Z");
    for (const empty of [value('""'), value("[]")]) {
      for (const target of types) {
        if (target === frontmatterFieldType(empty)) continue;
        assert.deepEqual(convertFieldValue(empty, target, today), initialFieldValue(target, today));
      }
    }
  });

  test("preserves authored scalar text and creates textual lists", () => {
    assert.deepEqual(convertFieldValue(value('""'), "list"), []);
    assert.deepEqual(convertFieldValue(value('"  Margaret   Hamilton  "'), "list"), ["  Margaret   Hamilton  "]);
    assert.equal(convertFieldValue(samples.number, "text"), "1e3");
    assert.deepEqual(convertFieldValue(samples.number, "list"), ["1e3"]);
    assert.equal(convertFieldValue(samples.boolean, "text"), "true");
    assert.deepEqual(convertFieldValue(samples.date, "list"), ["2026-07-31"]);
    assert.deepEqual(convertFieldValue(samples.datetime, "list"), ["2026-07-31T12:34:56Z"]);
  });

  test("does not parse text into semantic scalar types", () => {
    for (const target of ["number", "boolean", "date", "datetime"] as const) {
      assert.equal(convertFieldValue(value('"42"'), target), undefined);
      assert.equal(convertFieldValue(value('"true"'), target), undefined);
      assert.equal(convertFieldValue(value('"2026-07-31"'), target), undefined);
    }
  });

  test("unwraps exactly one string list item", () => {
    assert.equal(convertFieldValue(value('["42"]'), "number"), undefined);
    assert.equal(convertFieldValue(value('["42"]'), "text"), "42");
    assert.equal(convertFieldValue(value("[]"), "text"), "");
    assert.equal(convertFieldValue(value("[one, two]"), "text"), undefined);
    assert.equal(convertFieldValue(value("[[one]]"), "text"), undefined);
    assert.equal(convertFieldValue(value("[null]"), "text"), undefined);
  });

  test("converts a date to an explicit midnight datetime without truncating datetimes", () => {
    const midnight = convertFieldValue(samples.date, "datetime");
    assert.deepEqual(midnight, { kind: "datetime-input", value: new Date("2026-07-31T00:00:00.000Z") });

    const edited = editFrontmatterSource("---\nvalue: 2026-07-31\n---\n", {
      type: "upsert",
      key: "value",
      value: midnight!,
    });
    assert.equal(edited.success, true);
    assert.match(edited.success ? edited.source : "", /value: 2026-07-31T00:00:00/);
    assert.equal(value("2026-07-31T12:34:56Z").kind, "date");
    assert.equal(convertFieldValue(samples.datetime, "date"), undefined);
  });

  test("blocks unsupported and information-losing conversions", () => {
    for (const invalid of [value("null"), value("[one, two]"), value("[[one]]")]) {
      assert.equal(convertFieldValue(invalid, "text"), undefined);
    }
    assert.equal(convertFieldValue(samples.datetime, "date"), undefined);
    assert.equal(convertFieldValue(samples.text, "number"), undefined);
  });
});
