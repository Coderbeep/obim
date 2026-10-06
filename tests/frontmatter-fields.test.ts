import assert from "node:assert/strict";

import { test } from "vitest";

import { frontmatterFieldType } from "../src/shared/frontmatter-fields";
import { getFrontmatterProperty, parseFrontmatter } from "../src/shared/frontmatter";

test("parser lookup and field observations keep authored keys exact", () => {
  const parsed = parseFrontmatter("---\nAuthor: Ada\nauthor: Grace\n---\n");

  assert.equal(getFrontmatterProperty(parsed, "Author")?.value.kind, "string");
  assert.equal(getFrontmatterProperty(parsed, "author")?.value.kind, "string");
  assert.equal(getFrontmatterProperty(parsed, "AUTHOR"), undefined);
});

test("field types describe only values the structured editor can round-trip", () => {
  const parsed = parseFrontmatter(
    [
      "---",
      "text: value",
      "multiline: |-",
      "  first",
      "  second",
      "date: 2026-07-28",
      "timestamp: 2026-07-28T12:00:00Z",
      "list: [one, two]",
      "mixed: [one, 2]",
      "number: 1",
      "boolean: true",
      "empty:",
      "---",
    ].join("\n"),
  );

  assert.equal(parsed.kind, "valid");
  if (parsed.kind !== "valid") return;
  assert.deepEqual(
    Object.fromEntries(parsed.properties.map((property) => [property.key, frontmatterFieldType(property.value)])),
    {
      text: "text",
      multiline: "unsupported",
      date: "date",
      timestamp: "datetime",
      list: "list",
      mixed: "unsupported",
      number: "number",
      boolean: "boolean",
      empty: "unsupported",
    },
  );
});
