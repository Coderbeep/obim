import assert from "node:assert/strict";

import { EditorState, type TransactionSpec } from "@codemirror/state";
import { test } from "vitest";

import { frontmatterState } from "../src/renderer/src/features/editor/extensions/FrontmatterExtension";
import type { FrontmatterResult } from "../src/shared/frontmatter";

const createState = (doc: string) =>
  EditorState.create({
    doc,
    extensions: [frontmatterState],
  });

const apply = (state: EditorState, spec: TransactionSpec) => state.update(spec).state;
const parsed = (state: EditorState) => state.field(frontmatterState);

const requireValid = (result: FrontmatterResult) => {
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") assert.fail("expected valid frontmatter");
  return result;
};

test("selection-only transactions retain the parsed frontmatter object", () => {
  const doc = "---\ntitle: Old\n---\nBody";
  const state = createState(doc);
  const before = parsed(state);

  const after = parsed(apply(state, { selection: { anchor: doc.indexOf("Body") } }));

  assert.strictEqual(after, before);
});

test("valid frontmatter survives body insertions and deletions without reparsing", () => {
  const doc = "---\ntitle: Old\n---\nBody text";
  const state = createState(doc);
  const before = requireValid(parsed(state));

  const insertedState = apply(state, { changes: { from: doc.length, insert: "!" } });
  const afterInsertion = parsed(insertedState);
  assert.strictEqual(afterInsertion, before);

  const bodyFrom = insertedState.doc.toString().indexOf("Body");
  const deletedState = apply(insertedState, { changes: { from: bodyFrom, to: bodyFrom + "Body ".length } });
  const afterDeletion = parsed(deletedState);
  assert.strictEqual(afterDeletion, before);
  assert.deepEqual(requireValid(afterDeletion).properties[0]?.value, { kind: "string", value: "Old" });
});

test("frontmatter edits reparse when a multi-change transaction also edits the body", () => {
  const doc = "---\ntitle: Old\n---\nBody";
  const state = createState(doc);
  const before = requireValid(parsed(state));
  const valueFrom = doc.indexOf("Old");
  const bodyFrom = doc.indexOf("Body");

  const next = apply(state, {
    changes: [
      { from: valueFrom, to: valueFrom + "Old".length, insert: "New" },
      { from: bodyFrom, to: bodyFrom + "Body".length, insert: "Edited body" },
    ],
  });
  const after = parsed(next);

  assert.notStrictEqual(after, before);
  assert.deepEqual(requireValid(after).properties[0]?.value, { kind: "string", value: "New" });
  assert.match(next.doc.toString(), /Edited body$/);
});

test("editing the opening fence reparses frontmatter", () => {
  const doc = "---\ntitle: Old\n---\nBody";
  const state = createState(doc);
  const before = requireValid(parsed(state));

  const after = parsed(apply(state, { changes: { from: 2, to: 3, insert: "x" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "none");
});

test("deleting the closing fence reparses to unclosed frontmatter", () => {
  const doc = "---\ntitle: Old\n---\nBody";
  const state = createState(doc);
  const before = requireValid(parsed(state));
  const closingFrom = doc.lastIndexOf("---");

  const after = parsed(apply(state, { changes: { from: closingFrom, to: closingFrom + 3 } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "invalid");
  if (after.kind !== "invalid") assert.fail("expected invalid frontmatter");
  assert.equal(after.envelope, undefined);
});

test("body edits after a closed invalid envelope retain the parsed object", () => {
  const doc = "---\nvalue: [\n---\nBody";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "invalid");
  if (before.kind !== "invalid") assert.fail("expected invalid frontmatter");
  assert.ok(before.envelope);

  const bodyFrom = doc.indexOf("Body");
  const after = parsed(apply(state, { changes: { from: bodyFrom, to: bodyFrom + 4, insert: "Edited" } }));

  assert.strictEqual(after, before);
});

test("adding a distant closing fence reparses unclosed frontmatter", () => {
  const doc = "---\ntitle: Old\ncount: 1";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "invalid");
  if (before.kind !== "invalid") assert.fail("expected invalid frontmatter");
  assert.equal(before.envelope, undefined);

  const after = parsed(apply(state, { changes: { from: doc.length, insert: "\n---\n" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "valid");
});

test("body edits always reparse unclosed frontmatter", () => {
  const doc = "---\ntitle: Old\nbody text";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "invalid");

  const bodyFrom = doc.indexOf("body");
  const after = parsed(apply(state, { changes: { from: bodyFrom, to: bodyFrom + 4, insert: "copy" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "invalid");
});

test("multi-line documents without frontmatter reuse the result for later-line edits", () => {
  const doc = "Heading\nSecond line";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "none");

  const secondLine = doc.indexOf("Second");
  const after = parsed(apply(state, { changes: { from: secondLine + 6, insert: " edited" } }));

  assert.strictEqual(after, before);
});

test("editing offset two into an opening fence is detected", () => {
  const doc = "--x\nBody";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "none");

  const after = parsed(apply(state, { changes: { from: 2, to: 3, insert: "-" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "invalid");
});

test("removing the first line break reparses a document without frontmatter", () => {
  const doc = "Heading\nBody";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "none");

  const lineBreak = doc.indexOf("\n");
  const after = parsed(apply(state, { changes: { from: lineBreak, to: lineBreak + 1 } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "none");
});

test("a no-newline document reparses edits at the old end of the document", () => {
  const doc = "Body";
  const state = createState(doc);
  const before = parsed(state);
  assert.equal(before.kind, "none");

  const after = parsed(apply(state, { changes: { from: doc.length, insert: "!" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "none");
});

test("an insertion after a closing fence at EOF is treated conservatively", () => {
  const noLineBreak = "---\ntitle: Old\n---";
  const state = createState(noLineBreak);
  const before = requireValid(parsed(state));

  const after = parsed(apply(state, { changes: { from: noLineBreak.length, insert: "x" } }));

  assert.notStrictEqual(after, before);
  assert.equal(after.kind, "invalid");

  const withLineBreak = `${noLineBreak}\n`;
  const lineBreakState = createState(withLineBreak);
  const lineBreakBefore = requireValid(parsed(lineBreakState));
  const bodyAfter = parsed(apply(lineBreakState, { changes: { from: withLineBreak.length, insert: "Body" } }));
  assert.strictEqual(bodyAfter, lineBreakBefore);
});
