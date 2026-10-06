import assert from "node:assert/strict";

import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { test } from "vitest";

import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import {
  editFrontmatterSource,
  frontmatterValueToText,
  getFrontmatterProperty,
  getFrontmatterStringList,
  locateFrontmatter,
  parseFrontmatter,
  planFrontmatterEdit,
  type FrontmatterEdit,
} from "../src/shared/frontmatter";

const applyEdit = (source: string, edit: FrontmatterEdit) => {
  const result = editFrontmatterSource(source, edit);
  assert.equal(result.success, true, result.success ? undefined : result.error);
  if (!result.success) return source;
  return result.source;
};

function nodes(doc: string, name: string) {
  const state = EditorState.create({ doc, extensions: [obimMarkdown()] });
  const ranges: { from: number; text: string; to: number }[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== name) return;
      ranges.push({ from: node.from, to: node.to, text: state.doc.sliceString(node.from, node.to) });
    },
  });
  return ranges;
}

test("frontmatter parses only as a complete fenced block at document start", () => {
  const doc = "---\ntitle: Test\n---\nbody";

  assert.deepEqual(nodes(doc, "Frontmatter"), [{ from: 0, to: 20, text: "---\ntitle: Test\n---\n" }]);
  assert.deepEqual(
    nodes(doc, "FrontmatterMark").map((range) => range.text),
    ["---\n", "---\n"],
  );
});

test("frontmatter fences allow trailing spaces", () => {
  const doc = "---   \ntitle: Test\n--- \nbody";

  assert.deepEqual(nodes(doc, "Frontmatter"), [
    { from: 0, to: doc.indexOf("body"), text: "---   \ntitle: Test\n--- \n" },
  ]);
  assert.deepEqual(
    nodes(doc, "FrontmatterMark").map((range) => range.text),
    ["---   \n", "--- \n"],
  );
});

test("frontmatter ending at EOF does not extend past the document", () => {
  const doc = "---\ntitle: Test\n---";

  assert.deepEqual(nodes(doc, "Frontmatter"), [{ from: 0, to: doc.length, text: doc }]);
  assert.deepEqual(
    nodes(doc, "FrontmatterMark").map((range) => range.text),
    ["---\n", "---"],
  );
});

test("frontmatter-like blocks away from document start remain ordinary markdown", () => {
  assert.deepEqual(nodes("intro\n\n---\ntitle: Test\n---", "Frontmatter"), []);
});

test("unclosed or malformed frontmatter fences do not create a frontmatter node", () => {
  for (const doc of ["---\ntitle: Test", "---x\ntitle: Test\n---", "--\ntitle: Test\n--"]) {
    assert.deepEqual(nodes(doc, "Frontmatter"), []);
  }
});

test("frontmatter exposes ordered typed properties and source ranges", () => {
  const source = [
    "---",
    "title: Lecture",
    "published: false",
    "dueDate: 2026-07-18",
    "tags: [math, optimization]",
    "---",
    "body",
  ].join("\n");
  const frontmatter = parseFrontmatter(source);

  assert.equal(frontmatter.kind, "valid");
  if (frontmatter.kind !== "valid") return;

  assert.deepEqual(
    frontmatter.properties.map(({ key, value }) => [key, value.kind]),
    [
      ["title", "string"],
      ["published", "boolean"],
      ["dueDate", "date"],
      ["tags", "list"],
    ],
  );
  assert.equal(source.slice(frontmatter.properties[0].keyRange.from, frontmatter.properties[0].keyRange.to), "title");
  assert.equal(getFrontmatterProperty(frontmatter, "dueDate")?.value.kind, "date");
  const dueDate = getFrontmatterProperty(frontmatter, "dueDate")?.value;
  assert.equal(dueDate?.kind === "date" ? dueDate.dateOnly : undefined, true);
  assert.deepEqual(getFrontmatterStringList(frontmatter, "tags"), ["math", "optimization"]);
  assert.equal(frontmatterValueToText(frontmatter.properties[3].value), "2 items");
});

test("valid YAML outside the lossless subset remains available as raw source", () => {
  for (const source of [
    "---\ndetails:\n  room: 204\n---",
    "---\ndetails: { room: 204 }\n---",
    "---\ndetails: [one, { room: 204 }]\n---",
  ]) {
    const frontmatter = parseFrontmatter(source);
    assert.equal(frontmatter.kind, "valid");
    if (frontmatter.kind !== "valid") continue;
    assert.equal(frontmatter.managed, false);
    assert.equal(frontmatter.properties[0]?.value.kind, "unsupported");
  }
});

test("frontmatter distinguishes absent, unclosed, malformed, and duplicate properties", () => {
  assert.deepEqual(parseFrontmatter("# Note"), { kind: "none" });

  for (const source of ["---\ntitle: Note", "---\n- item\n---", "---\ntitle: [\n---", "---\na: 1\na: 2\n---"]) {
    assert.equal(parseFrontmatter(source).kind, "invalid");
  }
});

test("frontmatter preserves the source distinction between dates, timestamps, and multiline strings", () => {
  const parsed = parseFrontmatter(
    '---\ndate: 2026-07-14\nearly: 0001-01-01\nimpossible: 2024-02-30\nimpossibleStamp: 2026-07-14T25:61:00Z\nstamp: 2026-07-14T00:00:00Z\nsummary: |-\n  first\n  second\nescaped: "first\\rsecond"\nhuge: 9007199254740993\nprecise: 0.123456789012345678901\nmixed: [null]\ntags:\n  - one # keep\n---\n',
  );

  assert.equal(parsed.kind, "valid");
  if (parsed.kind !== "valid") return;
  assert.equal(parsed.managed, false);
  const date = getFrontmatterProperty(parsed, "date")?.value;
  const early = getFrontmatterProperty(parsed, "early")?.value;
  const impossible = getFrontmatterProperty(parsed, "impossible")?.value;
  const impossibleStamp = getFrontmatterProperty(parsed, "impossibleStamp")?.value;
  const stamp = getFrontmatterProperty(parsed, "stamp")?.value;
  const summary = getFrontmatterProperty(parsed, "summary")?.value;
  const escaped = getFrontmatterProperty(parsed, "escaped")?.value;
  const huge = getFrontmatterProperty(parsed, "huge")?.value;
  const precise = getFrontmatterProperty(parsed, "precise")?.value;
  const mixed = getFrontmatterProperty(parsed, "mixed")?.value;
  assert.equal(date?.kind === "date" ? date.dateOnly : undefined, true);
  assert.equal(early?.kind === "date" ? early.dateOnly : undefined, true);
  assert.equal(early?.kind === "date" ? early.value : undefined, "0001-01-01");
  assert.equal(impossible?.kind, "unsupported");
  assert.equal(impossibleStamp?.kind, "unsupported");
  assert.equal(stamp?.kind === "date" ? stamp.dateOnly : undefined, false);
  assert.equal(stamp?.kind === "date" ? stamp.source : undefined, "2026-07-14T00:00:00Z");
  assert.equal(summary?.kind === "string" ? summary.multiline : undefined, true);
  assert.equal(escaped?.kind === "string" ? escaped.multiline : undefined, true);
  assert.equal(escaped?.kind === "string" ? escaped.value : undefined, "first\rsecond");
  assert.equal(huge?.kind, "unsupported");
  assert.equal(precise?.kind === "number" ? precise.source : undefined, "0.123456789012345678901");
  assert.equal(mixed ? frontmatterValueToText(mixed) : undefined, "1 item");
  assert.equal(getFrontmatterProperty(parsed, "tags")?.valueHasComments, true);
});

test("anchors, aliases, tags, nulls, mixed lists, and commented lists use raw frontmatter", () => {
  for (const body of [
    "value: null",
    "value: [one, 2]",
    "value: &shared one\ncopy: *shared",
    "value: !custom one",
    "value:\n  - one # keep",
  ]) {
    const parsed = parseFrontmatter(`---\n${body}\n---\n`);
    assert.equal(parsed.kind, "valid", body);
    if (parsed.kind === "valid") assert.equal(parsed.managed, false, body);
  }
});

test("a trailing scalar comment stays in the managed lossless subset", () => {
  const parsed = parseFrontmatter("---\ntitle: Note # keep\n---\n");
  assert.equal(parsed.kind, "valid");
  if (parsed.kind === "valid") assert.equal(parsed.managed, true);
  assert.equal(
    applyEdit("---\ntitle: Note # keep\n---\n", { type: "upsert", key: "title", value: "Changed" }),
    "---\ntitle: Changed # keep\n---\n",
  );
});

test("frontmatter location preserves CRLF envelope ranges", () => {
  const source = "---\r\ntags: [one]\r\n---\r\nbody";
  const envelope = locateFrontmatter(source);

  assert.ok(envelope);
  assert.equal(envelope.newline, "\r\n");
  assert.equal(source.slice(envelope.bodyRange.from, envelope.bodyRange.to), "tags: [one]\r\n");
  assert.equal(source.slice(envelope.range.to), "body");
});

test("frontmatter edits touch only the requested property", () => {
  const source = [
    "---",
    "# keep this comment",
    "title: Old # and this one",
    "tags:",
    "  - one",
    "  - two",
    "count: 2",
    "---",
    "body",
  ].join("\n");

  const renamed = applyEdit(source, { type: "rename", key: "title", newKey: "name" });
  const updated = applyEdit(renamed, { type: "upsert", key: "count", value: 3 });
  const removed = applyEdit(updated, { type: "remove", key: "tags" });
  const added = applyEdit(removed, { type: "upsert", key: "published", value: true });

  assert.equal(
    added,
    ["---", "# keep this comment", "name: Old # and this one", "count: 3", "published: true", "---", "body"].join("\n"),
  );
  assert.equal(parseFrontmatter(added).kind, "valid");
});

test("frontmatter list edits remain valid across block and flow styles", () => {
  const block = "---\ntags:\n  - one\n  - two\n---\nbody";
  const updatedBlock = applyEdit(block, { type: "upsert", key: "tags", value: ["three", "four"] });
  const reparsedBlock = parseFrontmatter(updatedBlock);

  assert.equal(reparsedBlock.kind, "valid");
  assert.deepEqual(getFrontmatterStringList(reparsedBlock, "tags"), ["three", "four"]);
  assert.match(updatedBlock, /tags:\n {2}\[ three, four \]/);

  const flow = "---\ntags: [one, two]\n---\nbody";
  const updatedFlow = applyEdit(flow, { type: "upsert", key: "tags", value: ["three"] });
  assert.equal(parseFrontmatter(updatedFlow).kind, "valid");
  assert.match(updatedFlow, /tags: \[ three \]/);
});

test("top-level flow maps support precise property edits", () => {
  const source = [
    "---",
    "{ author: [ Radia Perlman ], status: draft, tags: [networks, computing] }",
    "---",
    "body",
  ].join("\n");
  const updated = applyEdit(source, { type: "upsert", key: "tags", value: ["systems"] });
  const renamed = applyEdit(updated, { type: "rename", key: "status", newKey: "state" });
  const removed = applyEdit(renamed, { type: "remove", key: "author" });
  const added = applyEdit(removed, { type: "insert", key: "priority", value: 1 });

  assert.equal(added, "---\n{ state: draft, tags: [ systems ], priority: 1 }\n---\nbody");
  const parsed = parseFrontmatter(added);
  assert.equal(parsed.kind, "valid");
  assert.equal(parsed.kind === "valid" ? parsed.flow : false, true);
});

test("top-level flow removals preserve neighboring fields and comments", () => {
  assert.equal(applyEdit("---\n{ a: 1, b: 2, c: 3 }\n---", { type: "remove", key: "b" }), "---\n{ a: 1, c: 3 }\n---");
  assert.equal(applyEdit("---\n{ a: 1, b: 2 }\n---", { type: "remove", key: "b" }), "---\n{ a: 1 }\n---");
  assert.equal(applyEdit("---\n{ only: 1 }\n---", { type: "remove", key: "only" }), "---\n{ }\n---");

  const commented = applyEdit("---\n{\n a: 1,\n # b comment, comma\n b: 2\n}\n---", {
    type: "remove",
    key: "a",
  });
  assert.match(commented, /# b comment, comma/);
  assert.equal(getFrontmatterProperty(parseFrontmatter(commented), "b")?.value.kind, "number");
});

test("top-level empty flow maps accept their first property", () => {
  const updated = applyEdit("---\n{}\n---\nbody", { type: "insert", key: "status", value: "draft" });

  assert.equal(updated, "---\n{status: draft}\n---\nbody");
  assert.equal(getFrontmatterProperty(parseFrontmatter(updated), "status")?.value.kind, "string");

  const trailingComma = applyEdit("---\n{ status: draft, }\n---", {
    type: "insert",
    key: "priority",
    value: "high",
  });
  assert.equal(trailingComma, "---\n{ status: draft, priority: high}\n---");
  assert.equal(parseFrontmatter(trailingComma).kind, "valid");
});

test("frontmatter edits preserve the distinction between strings and dates", () => {
  const source = "---\nlabel: original\ndueDate: 2026-07-18\n---\nbody";
  const withString = applyEdit(source, { type: "upsert", key: "label", value: "2026-08-01" });
  const withDate = applyEdit(withString, {
    type: "upsert",
    key: "dueDate",
    value: new Date("2026-08-02T00:00:00.000Z"),
  });
  const withDateLikeKey = applyEdit(withDate, { type: "upsert", key: "2026-08-03", value: "release" });
  const parsed = parseFrontmatter(withDateLikeKey);

  assert.equal(parsed.kind, "valid");
  if (parsed.kind !== "valid") return;
  assert.equal(getFrontmatterProperty(parsed, "label")?.value.kind, "string");
  assert.equal(getFrontmatterProperty(parsed, "dueDate")?.value.kind, "date");
  assert.deepEqual(getFrontmatterProperty(parsed, "2026-08-03")?.value, { kind: "string", value: "release" });
  assert.match(withDateLikeKey, /label: "2026-08-01"/);
  assert.match(withDateLikeKey, /dueDate: 2026-08-02/);
  assert.match(withDateLikeKey, /"2026-08-03": release/);
});

test("frontmatter edits create a block lazily and reject destructive ambiguity", () => {
  assert.equal(
    applyEdit("# Note", { type: "upsert", key: "tags", value: ["one", "two"] }),
    "---\ntags: [ one, two ]\n---\n\n# Note",
  );

  const duplicate = planFrontmatterEdit("---\na: 1\nb: 2\n---", { type: "rename", key: "a", newKey: "b" });
  assert.deepEqual(duplicate, { success: false, error: "Property “b” already exists." });

  const duplicateAdd = planFrontmatterEdit("---\na: 1\n---", { type: "insert", key: "a", value: 2 });
  assert.deepEqual(duplicateAdd, { success: false, error: "Property “a” already exists." });

  const malformed = planFrontmatterEdit("---\na: [\n---", { type: "upsert", key: "a", value: "safe" });
  assert.equal(malformed.success, false);
});

test("frontmatter edits keep long scalar values on a valid YAML line", () => {
  const longPath =
    "Identification of Convective and Stratiform Precipitation in Tropical Cyclones from Satellite Passive Microwave Observations.pdf";
  const updated = applyEdit("", { type: "upsert", key: "pdf", value: longPath });
  const parsed = parseFrontmatter(updated);

  assert.equal(parsed.kind, "valid");
  assert.deepEqual(getFrontmatterProperty(parsed, "pdf")?.value, { kind: "string", value: longPath });
  assert.equal(updated, `---\npdf: ${longPath}\n---\n`);
});

test("frontmatter edits add the first property to an empty block", () => {
  const updated = applyEdit("---\n---\nbody", { type: "insert", key: "status", value: "draft" });

  assert.equal(updated, "---\nstatus: draft\n---\nbody");
  assert.equal(parseFrontmatter(updated).kind, "valid");
});

test("frontmatter edits can add a property after removing the last one", () => {
  const source = "---\nstatus: draft\n---\nbody";
  const emptied = applyEdit(source, { type: "remove", key: "status" });
  const restored = applyEdit(emptied, { type: "upsert", key: "priority", value: "high" });

  assert.equal(emptied, "---\n---\nbody");
  assert.equal(restored, "---\npriority: high\n---\nbody");
  assert.equal(parseFrontmatter(restored).kind, "valid");
});

test("frontmatter edits address existing keys exactly", () => {
  const source = '---\n" status ": draft\nstatus: published\n---\nbody';
  const updated = applyEdit(source, { type: "upsert", key: " status ", value: "review" });
  const removed = applyEdit(updated, { type: "remove", key: " status " });

  assert.match(updated, /" status ": review/);
  assert.match(updated, /\nstatus: published/);
  assert.doesNotMatch(removed, /" status "/);
  assert.match(removed, /\nstatus: published/);
});

test("frontmatter source edits preserve newline style, comments, and unrelated Markdown", () => {
  const source = "---\r\n# keep\r\na: old # comment\r\n---\r\n# Body\r\n";
  const edit = { type: "upsert", key: "a", value: "new" } as const;
  const planned = planFrontmatterEdit(source, edit);
  const complete = editFrontmatterSource(source, edit);

  assert.equal(planned.success, true);
  assert.equal(complete.success, true);
  if (!planned.success || !complete.success) return;
  assert.equal(
    complete.source,
    source.slice(0, planned.change.from) + planned.change.insert + source.slice(planned.change.to),
  );
  assert.equal(complete.source, "---\r\n# keep\r\na: new # comment\r\n---\r\n# Body\r\n");
});

test("frontmatter insert and upsert have distinct semantics", () => {
  const source = "---\na: old\n---\nbody";

  assert.deepEqual(planFrontmatterEdit(source, { type: "insert", key: "a", value: "new" }), {
    success: false,
    error: "Property “a” already exists.",
  });
  assert.equal(editFrontmatterSource(source, { type: "upsert", key: "a", value: "new" }).success, true);
});
