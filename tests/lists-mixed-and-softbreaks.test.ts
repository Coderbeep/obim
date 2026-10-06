import { test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { TaskList } from "@lezer/markdown";

import { createListsExtension } from "../src/renderer/src/features/editor/extensions/ListsExtension";
import { insertNewlineContinueMarkup } from "../src/renderer/src/features/editor/extensions/shared/commands";
import { marked, mutableFakeView } from "./cm-extension-test-utils";

// Interaction suite for mixed-type nested lists (bullet↔ordered transitions) and soft-break
// continuation lines (Shift+Enter "subparagraphs"). See specs/agent/worksheet-lists-adversarial-hardening.md.
//
// Shift+Enter is the local list-aware insertNewlineContinueMarkup from extensions/shared/commands
// (bound separately in setup.ts, not part of createListsExtension). Enter/Tab/Shift-Tab go through
// the lists keymap. Every expectation below was verified empirically against the real commands;
// commentary marks defensible quirks so silent changes get noticed.
//
// CommonMark parsing facts that drive several results here:
// - Empty list items cannot interrupt a paragraph, so an empty marker typed after item text is
//   paragraph text, not a nested list ("1. a\n   - " has no nested list).
// - A blank line ends the innermost list item, so Enter on a blank soft-break line declines.

function pureExtensions(): Extension[] {
  return [markdown({ base: markdownLanguage, extensions: [TaskList] }), indentUnit.of("    ")];
}

function listExtensions(): Extension[] {
  return [...pureExtensions(), createListsExtension(() => false)];
}

function stateFrom(text: string, selection: { from: number; to: number }, extensions: Extension[]) {
  return EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions,
  });
}

function listState(input: string) {
  const { text, selection } = marked(input);
  return stateFrom(text, selection, listExtensions());
}

function runKey(input: string, key: string) {
  const { view } = mutableFakeView(listState(input));
  const binding = view.state.facet(keymap).flat().find((candidate) => candidate.key === key);

  assert.ok(binding?.run, `${key} binding should be registered`);
  const handled = binding.run(view);

  return { handled, state: view.state };
}

function runShiftEnter(input: string) {
  const { view } = mutableFakeView(listState(input));
  const handled = insertNewlineContinueMarkup(view);

  return { handled, state: view.state };
}

function assertDoc(result: { handled: boolean; state: EditorState }, expectedDoc: string, context: string) {
  assert.equal(result.handled, true, `${context}: command should handle the key`);
  assert.equal(result.state.doc.toString(), expectedDoc, context);
}

test("Shift+Enter indents a soft break to the item content column", () => {
  assertDoc(runShiftEnter("- Some text|"), "- Some text\n  ", "bullet item");
  assertDoc(runShiftEnter("1. Some text|"), "1. Some text\n   ", "ordered item");
  assertDoc(runShiftEnter("10. item|"), "10. item\n    ", "two-digit marker aligns past the wider marker");
  assertDoc(runShiftEnter("- [ ] task|"), "- [ ] task\n      ", "task item aligns past the checkbox");
  assertDoc(runShiftEnter("1. [x] done|"), "1. [x] done\n       ", "ordered task item");
  assertDoc(runShiftEnter("- parent\n  - child|"), "- parent\n  - child\n    ", "nested child");
  assertDoc(runShiftEnter("> - item|"), "> - item\n>   ", "quoted item keeps the quote prefix");
  assertDoc(runShiftEnter("1. parent\n   - [ ] kid|"), "1. parent\n   - [ ] kid\n         ", "quoted-width task child");
});

test("Shift+Enter splits the line at the cursor without creating a marker", () => {
  assertDoc(runShiftEnter("- Some o|ther text"), "- Some o\n  ther text", "mid-text split");
});

test("Shift+Enter before the next item creates a blank continuation line", () => {
  // A whitespace-only line makes the list loose per CommonMark; no marker is touched.
  assertDoc(runShiftEnter("- a|\n- b"), "- a\n  \n- b", "blank continuation between items");
});

test("Shift+Enter on an empty marker keeps the marker line intact", () => {
  assertDoc(runShiftEnter("- |"), "- \n  ", "empty marker item");
});

test("Shift+Enter handles every cursor of a multi-range selection", () => {
  // The app currently never enables EditorState.allowMultipleSelections, so multi-cursor
  // selections cannot exist there; this pins the command's own per-range capability.
  const state = stateFrom("- aa\n- bb", { from: 0, to: 0 }, [
    ...listExtensions(),
    EditorState.allowMultipleSelections.of(true),
  ])
    .update({ selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(9)]) })
    .state;
  const { view } = mutableFakeView(state);
  const handled = insertNewlineContinueMarkup(view);

  assert.equal(handled, true);
  assert.equal(view.state.doc.toString(), "- aa\n  \n- bb\n  ");
});

test("Shift+Enter declines non-empty selections", () => {
  const result = runShiftEnter("- [a]");

  assert.equal(result.handled, false);
  assert.equal(result.state.doc.toString(), "- a");
});

test("Shift+Enter falls back to line indentation outside list items", () => {
  assertDoc(runShiftEnter("hello|"), "hello\n", "plain paragraph");
  assertDoc(runShiftEnter("```\ncode|"), "```\ncode\n", "top-level fenced code");
  assertDoc(runShiftEnter("- item\n  ```\n  code|"), "- item\n  ```\n  code\n  ", "fence inside an item");
  // Quirk: the local command is list-aware only. A plain blockquote loses its "> " on the new
  // line, which stays a lazy continuation of the quoted paragraph per CommonMark but differs from
  // lang-markdown's own Enter (which re-inserts "> ").
  assertDoc(runShiftEnter("> text|"), "> text\n", "plain blockquote drops the marker");
  // A tab-indented list parses as an indented code block (tab = one indent unit), so the item
  // lookup misses and the line's own whitespace is reused.
  assertDoc(runShiftEnter("\t- item|"), "\t- item\n\t", "tab-indented list behaves as code");
});

test("Shift+Enter with the cursor inside an ordered marker splits it without renumbering", () => {
  // The marker text is destroyed, but the surviving text is no longer parsed as a list marker, so
  // the renumbering filter correctly declines to repair anything.
  assertDoc(runShiftEnter("1.| x"), "1.\n    x", "cursor right after the digits");
  assertDoc(runShiftEnter("1|0. x"), "1\n    0. x", "cursor between the digits");
});

test("Enter on a blank soft-break line declines (the blank line ended the item)", () => {
  // In the real editor the decline falls through to lang-markdown's Enter; that behavior belongs
  // to lang-markdown and is intentionally not pinned here.
  const bullet = runKey("- Some text\n  |", "Enter");
  assert.equal(bullet.handled, false);
  assert.equal(bullet.state.doc.toString(), "- Some text\n  ");

  const ordered = runKey("1. Some text\n   |", "Enter");
  assert.equal(ordered.handled, false);
  assert.equal(ordered.state.doc.toString(), "1. Some text\n   ");

  const quoted = runKey("> - a\n>   |", "Enter");
  assert.equal(quoted.handled, false);
  assert.equal(quoted.state.doc.toString(), "> - a\n>   ");
});

test("Enter continues the nearest item's marker from a text continuation line", () => {
  assertDoc(runKey("- a\n  cont|", "Enter"), "- a\n  cont\n- ", "bullet parent");
  assertDoc(runKey("10. x\n    cont|", "Enter"), "10. x\n    cont\n11. ", "two-digit ordered parent");
  assertDoc(runKey("1. parent\n   - child\n     cont|", "Enter"), "1. parent\n   - child\n     cont\n   - ", "bullet child of ordered parent");
  assertDoc(runKey("> - a\n>   cont|", "Enter"), "> - a\n>   cont\n> - ", "quoted list item");
});

test("Enter on a typed pseudo-marker continuation inserts the item's marker, not the typed number", () => {
  // "  2. b" is paragraph text: an ordered item starting at 2 cannot interrupt a paragraph, so it
  // never became a list. Enter therefore continues the bullet item itself.
  assertDoc(runKey("- a\n  2. b|", "Enter"), "- a\n  2. b\n- ", "pseudo-marker stays text");
});

test("the documented bullet flow: soft break, continuation, marker line, Tab, Enter", () => {
  // The user example from the feature gate:
  //   - Some text
  //     some other text
  //     - Another list mark
  const broken = runShiftEnter("- Some text|");
  assert.equal(broken.state.doc.toString(), "- Some text\n  ");

  const typed = broken.state.update({ changes: { from: 14, insert: "some other text" }, userEvent: "input" }).state;
  assert.equal(typed.doc.toString(), "- Some text\n  some other text");

  assertDoc(runKey("- Some text\n  some other text\n- Another list mark|", "Tab"), "- Some text\n  some other text\n    - Another list mark", "Tab nests the typed marker under the item");

  assertDoc(runKey("- Some text\n  some other text\n    - Another list mark|", "Enter"), "- Some text\n  some other text\n    - Another list mark\n    - ", "Enter continues the nested child");
  assertDoc(runKey("- Some text\n  some other text\n    - Another list mark|", "Shift-Tab"), "- Some text\n  some other text\n- Another list mark", "Shift-Tab returns it to a top-level sibling");
});

test("the documented ordered flow: soft break, continuation, '1.' line, Tab, Enter", () => {
  //   1. Some text
  //      some another text
  //      1. dasdsad a
  // "1." at column 0 can interrupt the paragraph, so it parses as the next item of the outer
  // ordered list before Tab; Tab then nests it as a child list and keeps "1.".
  assertDoc(runKey("1. Some text\n   some another text\n1. dasdsad a|", "Tab"), "1. Some text\n   some another text\n   1. dasdsad a", "Tab nests the child and keeps its 1.");

  assertDoc(runKey("1. Some text\n   some another text\n   1. dasdsad a|", "Enter"), "1. Some text\n   some another text\n   1. dasdsad a\n   2. ", "Enter continues the child list");
  assertDoc(runShiftEnter("1. Some text\n   some another text\n   1. dasdsad a|"), "1. Some text\n   some another text\n   1. dasdsad a\n      ", "Shift+Enter soft-breaks inside the child");
});

test("Tab nests a bullet child under its ordered sibling by one indent unit", () => {
  assertDoc(runKey("1. a\n   - b\n   - c|", "Tab"), "1. a\n   - b\n       - c", "bullet child deepens under its sibling");
});

test("Tab nests an ordered sibling under the previous item and resets it to 1", () => {
  // The typed "2." becomes a child list of "1. a"; the Tab reset rationale then restarts it at 1.
  assertDoc(runKey("- p\n  1. a\n  2. b|", "Tab"), "- p\n  1. a\n     1. b", "ordered sibling nests and renumbers");
  // ...and Shift-Tab restores the sibling numbering exactly.
  assertDoc(runKey("- p\n  1. a\n     1. b|", "Shift-Tab"), "- p\n  1. a\n  2. b", "Shift-Tab restores the sibling");
});

test("Tab also normalizes pre-existing duplicate numbering while nesting", () => {
  // Input "1. a / 1. b / 2. c": nesting "2. c" under "1. b" triggers a full Tab renumber that
  // rewrites the malformed "1. b" sibling to "2. b".
  assertDoc(runKey("- p\n  1. a\n  1. b\n  2. c|", "Tab"), "- p\n  1. a\n  2. b\n     1. c", "Tab renumber normalizes siblings");
});

test("Tab on the first item of a child list is a deliberate no-op", () => {
  // childIndent comes from the previous sibling; with no sibling there is no safe target, so the
  // command reports success without changing anything (mixed-selection Tab quirk family).
  const result = runKey("1. a\n   - b\n   - c|", "Tab");
  assert.equal(result.handled, true);
  // Sanity: the sibling case above does move; here the *first* child stays put.
  const first = runKey("1. a\n   |- b\n   - c", "Tab");
  assert.equal(first.handled, true);
  assert.equal(first.state.doc.toString(), "1. a\n   - b\n   - c");
});

test("Tab deepens through three mixed levels", () => {
  assertDoc(runKey("- p\n  1. a\n     - b\n     - c|", "Tab"), "- p\n  1. a\n     - b\n         - c", "third-level child");
});

test("Tab on a pseudo-marker continuation falls back to plain indentation", () => {
  // The line is paragraph text, so the list-aware path declines and indentMore runs; the text
  // stays a lazy continuation rather than being promoted to a list.
  assertDoc(runKey("- a\n  2. b|", "Tab"), "- a\n      2. b", "plain indent fallback");
});

test("Tab across a mixed selection still indents only parsed list lines", () => {
  const text = "- a\n  cont\n  - b";
  const { view } = mutableFakeView(stateFrom(text, { from: 4, to: text.length }, listExtensions()));
  const binding = view.state.facet(keymap).flat().find((candidate) => candidate.key === "Tab");
  assert.ok(binding?.run);

  const handled = binding.run(view);

  // The continuation line is not a list item and the sole child has no childIndent target, so the
  // command succeeds while changing nothing.
  assert.equal(handled, true);
  assert.equal(view.state.doc.toString(), text);
});

test("Enter on an empty nested marker with a parsed sibling converts to the parent marker", () => {
  // With a preceding sibling the empty item parses, so the dedent-exit path runs.
  assertDoc(runKey("1. a\n   - b\n   - |", "Enter"), "1. a\n   - b\n2. ", "empty bullet child of ordered parent");
  assertDoc(runKey("- p\n  1. a\n  1. |", "Enter"), "- p\n  1. a\n- ", "empty ordered child of bullet parent");
});

test("Enter on an empty quoted nested marker declines (known quote-blindness)", () => {
  // emptyListMarkerLine and continuedListMarkerFromLine do not strip "> " prefixes, so the quoted
  // empty item neither dedents nor continues.
  const result = runKey("> - p\n>   1. c\n>      - |", "Enter");

  assert.equal(result.handled, false);
  assert.equal(result.state.doc.toString(), "> - p\n>   1. c\n>      - ");
});

test("typed marker numbers survive renumbering across mixed nesting", () => {
  const nested = (() => {
    const { view } = mutableFakeView(listState("- a\n  1. b\n  |2. c"));
    view.dispatch({ changes: { from: 13, to: 14, insert: "5" }, userEvent: "input" });
    return view.state.doc.toString();
  })();
  assert.equal(nested, "- a\n  1. b\n  5. c", "typed number kept in a nested ordered list");

  const outer = (() => {
    const { view } = mutableFakeView(listState("1. a\n   - b\n|2. c"));
    view.dispatch({ changes: { from: 12, to: 13, insert: "9" }, userEvent: "input" });
    return view.state.doc.toString();
  })();
  assert.equal(outer, "1. a\n   - b\n9. c", "typed number kept with a nested bullet between ordered siblings");
});

test("Enter declines multi-cursor selections", () => {
  // Multi-cursor cannot occur in the app (allowMultipleSelections stays off), but the guard is
  // part of the command contract.
  const state = stateFrom("- aa\n- bb", { from: 0, to: 0 }, [
    ...listExtensions(),
    EditorState.allowMultipleSelections.of(true),
  ])
    .update({ selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(9)]) })
    .state;
  const { view } = mutableFakeView(state);
  const binding = view.state.facet(keymap).flat().find((candidate) => candidate.key === "Enter");
  assert.ok(binding?.run);

  const handled = binding.run(view);

  assert.equal(handled, false);
  assert.equal(view.state.doc.toString(), "- aa\n- bb");
});
