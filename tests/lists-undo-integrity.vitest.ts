// @vitest-environment jsdom
import { afterEach, test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { TaskList } from "@lezer/markdown";

import { createListsExtension } from "../src/renderer/src/features/editor/extensions/ListsExtension";
import { insertNewlineContinueMarkup } from "../src/renderer/src/features/editor/extensions/shared/commands";
import { installCodeMirrorDomPolyfills } from "./cm-extension-test-utils";

// Undo/redo integrity for the list extensions, exercised through a real EditorView because the
// fake test view composes filtered transaction arrays differently from a real dispatch.
// See specs/agent/worksheet-lists-adversarial-hardening.md.

installCodeMirrorDomPolyfills();

const views: EditorView[] = [];

function extensions(): Extension[] {
  return [
    markdown({ base: markdownLanguage, extensions: [TaskList] }),
    indentUnit.of("    "),
    createListsExtension(() => false),
    history(),
  ];
}

function makeView(doc: string) {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: 0, head: 0 }, extensions: extensions() }),
  });
  views.push(view);
  return view;
}

function undoRedoRoundTrip(doc: string, spec: TransactionSpec) {
  const view = makeView(doc);
  view.dispatch(spec);
  const after = view.state.doc.toString();

  assert.equal(undo(view), true, `undo must be available after ${JSON.stringify(spec)} on ${JSON.stringify(doc)}`);
  assert.equal(
    view.state.doc.toString(),
    doc,
    `undo after ${JSON.stringify(spec)} must restore ${JSON.stringify(doc)}, got ${JSON.stringify(view.state.doc.toString())}`,
  );

  assert.equal(redo(view), true, `redo must be available after undoing ${JSON.stringify(spec)}`);
  assert.equal(view.state.doc.toString(), after, `redo must reproduce the post-edit document`);
}

// Round-trip a keymap or soft-break command (which may compose renumbering changes) on a real view.
function commandRoundTrip(doc: string, key: string | null, run: (view: EditorView) => boolean) {
  const view = makeView(doc);
  view.dispatch({ selection: { anchor: doc.length } });

  const handled = run(view);
  const after = view.state.doc.toString();

  assert.equal(handled, true, `${key ?? "command"} should handle ${JSON.stringify(doc)}`);
  assert.notEqual(after, doc, `${key ?? "command"} should change ${JSON.stringify(doc)}`);

  assert.equal(undo(view), true, `undo must be available after ${key} on ${JSON.stringify(doc)}`);
  assert.equal(
    view.state.doc.toString(),
    doc,
    `undo after ${key} must restore ${JSON.stringify(doc)}, got ${JSON.stringify(view.state.doc.toString())}`,
  );

  assert.equal(redo(view), true, `redo must be available after undoing ${key}`);
  assert.equal(view.state.doc.toString(), after, `redo must reproduce the post-${key} document`);
}

function listKeyRun(key: string) {
  return (view: EditorView) => {
    const binding = view.state.facet(keymap).flat().find((candidate) => candidate.key === key);
    assert.ok(binding?.run, `${key} binding should be registered`);
    return binding.run(view);
  };
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy());
  document.body.replaceChildren();
});

test("undo/redo restore leading-zero marker edits exactly", () => {
  undoRedoRoundTrip("007. zeros\n8. more", { changes: { from: 2, to: 3, insert: "" } });
  undoRedoRoundTrip("007. zeros\n8. more", { changes: { from: 0, to: 2, insert: "" } });
  undoRedoRoundTrip("10. one\n11. two\n12. three", { changes: { from: 1, to: 2, insert: "" } });
});

test("undo/redo restore marker renumbering edits exactly", () => {
  undoRedoRoundTrip("1. one\n2. two\n3. three", { changes: { from: 6, to: 7, insert: "7" } });
  undoRedoRoundTrip("1. a\n2. b", { changes: { from: 0, to: 1, insert: "9" } });
});

test("undo/redo restore structure edits near lists exactly", () => {
  undoRedoRoundTrip("1. a\n2. b", { changes: { from: 0, insert: "```\n" } });
  undoRedoRoundTrip("1. a\n\n5. b\n6. c", { changes: { from: 5, to: 6, insert: "" } });
  undoRedoRoundTrip("1. a\n2. b", { changes: { from: 4, to: 4, insert: "\n- " } });
});

test("undo/redo stay exact across randomized list edit sequences", () => {
  // Deterministic mini-fuzz on a real view; each step is isolated into its own history event so a
  // per-step round-trip is meaningful.
  let seedState = 0x2e7d1;

  const random = () => {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const insertions = ["1", "7", "0", ".", ")", "-", " ", "\n", ">", "`"];
  let doc = "1. one\n2. two\n- bullet\n> 1. quoted\n007. zeros\n8. more";

  for (let step = 0; step < 40; step++) {
    const view = makeView(doc);
    const position = Math.floor(random() * (doc.length + 1));
    const changes =
      random() < 0.5
        ? { from: position, to: position, insert: insertions[Math.floor(random() * insertions.length)] }
        : { from: position, to: Math.min(doc.length, position + 1 + Math.floor(random() * 2)), insert: "" };

    view.dispatch({ changes, annotations: isolateHistory.of("full") });
    const after = view.state.doc.toString();

    if (after !== doc) {
      assert.equal(undo(view), true, `step ${step}: undo must be available`);
      assert.equal(
        view.state.doc.toString(),
        doc,
        `step ${step}: undo must restore ${JSON.stringify(doc)}, got ${JSON.stringify(view.state.doc.toString())}`,
      );
      assert.equal(redo(view), true, `step ${step}: redo must be available`);
      assert.equal(view.state.doc.toString(), after, `step ${step}: redo must reproduce the edit`);
    }

    doc = after;
  }
});

test("undo/redo stay exact through mixed-list Tab nesting and dedent", () => {
  // Tab nests the ordered sibling under "1. a" and composes a renumber (2. -> 1.).
  commandRoundTrip("- p\n  1. a\n  2. b", "Tab", listKeyRun("Tab"));
  // Shift-Tab dedents it back and renumbers 1. -> 2. again.
  commandRoundTrip("- p\n  1. a\n     1. b", "Shift-Tab", listKeyRun("Shift-Tab"));
  // Bullet child of an ordered parent deepens without renumbering.
  commandRoundTrip("1. a\n   - b\n   - c", "Tab", listKeyRun("Tab"));
});

test("undo/redo stay exact through the documented mixed user flows", () => {
  // Bullet flow: Tab nests the typed marker under the soft-broken item.
  commandRoundTrip("- Some text\n  some other text\n- Another list mark", "Tab", listKeyRun("Tab"));
  // Ordered flow: Tab nests the typed "1." line as a child list, keeping its number.
  commandRoundTrip("1. Some text\n   some another text\n1. dasdsad a", "Tab", listKeyRun("Tab"));
});

test("undo/redo stay exact for soft breaks and continuation Enter in mixed lists", () => {
  // Shift+Enter soft break (never renumbers, but must round-trip exactly).
  commandRoundTrip("- Some text", "Shift-Enter", insertNewlineContinueMarkup);
  commandRoundTrip("1. Some text\n   some another text\n   1. dasdsad a", "Shift-Enter", insertNewlineContinueMarkup);
  // Enter continues the nearest item's marker from a continuation line.
  commandRoundTrip("1. parent\n   - child\n     cont", "Enter", listKeyRun("Enter"));
  commandRoundTrip("- Some text\n  some other text", "Enter", listKeyRun("Enter"));
});
