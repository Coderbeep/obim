import { test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import { Annotation, EditorSelection, EditorState, StateField } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { TaskList } from "@lezer/markdown";
import type { StateCommand, Transaction } from "@codemirror/state";

import {
  buildListDecorations,
  createListsExtension,
  listAwareIndentLess,
  listAwareIndentMore,
  transactionMayTouchOrderedListMarker,
} from "../src/renderer/src/features/editor/extensions/ListsExtension";
import { childNode } from "../src/renderer/src/features/editor/extensions/shared/syntaxDecorationPlugin";
import {
  marked,
  mutableFakeView,
  rangesForState,
  rangesWithClass,
  replacedTexts,
  textsWithClass,
} from "./cm-extension-test-utils";

function listState(input: string) {
  const { text, selection } = marked(input);

  return listStateFromText(text, selection);
}

function listStateFromText(text: string, selection: { from: number; to: number }) {
  return EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions: [markdown({ base: markdownLanguage, extensions: [TaskList] }), indentUnit.of("    ")],
  });
}

function listExtensionState(input: string, editorOverlayOpen = false) {
  const { text, selection } = marked(input);

  return EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [TaskList] }),
      indentUnit.of("    "),
      createListsExtension(() => editorOverlayOpen),
    ],
  });
}

function runListKey(input: string, key: string, editorOverlayOpen = false) {
  const { view } = mutableFakeView(listExtensionState(input, editorOverlayOpen));
  const binding = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === key);

  assert.ok(binding?.run, `${key} binding should be registered`);
  const handled = binding.run(view);

  return { handled, state: view.state };
}

function runCommand(command: StateCommand, state: EditorState) {
  const transactions: Transaction[] = [];
  const handled = command({
    state,
    dispatch: (next) => {
      transactions.push(next);
    },
  });

  assert.equal(handled, true);
  const transaction = transactions.at(-1);
  assert.ok(transaction, "command should dispatch a transaction");
  return transaction.state;
}

function runHandledCommand(command: StateCommand, state: EditorState) {
  const transactions: Transaction[] = [];
  const handled = command({
    state,
    dispatch: (next) => {
      transactions.push(next);
    },
  });

  assert.equal(handled, true);
  return transactions.at(-1)?.state ?? state;
}

function listItemIndents(state: EditorState) {
  const indents: number[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "ListItem") return;

      const mark = childNode(node, "ListMark");
      if (!mark) return;

      indents.push(mark.from - state.doc.lineAt(mark.from).from);
    },
  });

  return indents;
}

function listRanges(input: string) {
  return rangesForState(buildListDecorations, listState(input));
}

test("unordered marker becomes a visual bullet after its separating space", () => {
  const pending = listRanges("-| ");
  const bullet = listRanges("- |");

  assert.deepEqual(replacedTexts(pending), []);
  assert.deepEqual(replacedTexts(bullet), ["-"]);
  assert.equal(bullet.find((range) => range.text === "-")?.widgetName, "BulletMarkerWidget");
});

test("indenting a task item uses the editor's unordered-list indent width", () => {
  const state = runCommand(listAwareIndentMore, listState("- [ ] parent\n|- [ ] child"));

  assert.equal(state.doc.toString(), "- [ ] parent\n    - [ ] child");
  assert.deepEqual(listItemIndents(state), [0, 4]);
});

test("indenting under a checked task uses the editor's unordered-list indent width", () => {
  const state = runCommand(listAwareIndentMore, listState("- [x] parent\n|- [ ] child"));

  assert.equal(state.doc.toString(), "- [x] parent\n    - [ ] child");
  assert.deepEqual(listItemIndents(state), [0, 4]);
});

test("indenting an ordered task item uses the ordered marker column", () => {
  const state = runCommand(listAwareIndentMore, listState("1. [ ] parent\n|2. [ ] child"));

  assert.equal(state.doc.toString(), "1. [ ] parent\n   2. [ ] child");
  assert.deepEqual(listItemIndents(state), [0, 3]);
});

test("indenting a task item preserves an existing child-list indentation width", () => {
  const state = runCommand(listAwareIndentMore, listState("- [ ] parent\n    - [ ] existing\n|- [ ] sibling"));

  assert.equal(state.doc.toString(), "- [ ] parent\n    - [ ] existing\n    - [ ] sibling");
  assert.deepEqual(listItemIndents(state), [0, 4, 4]);
});

test("indenting selected sibling task items nests each selected line consistently", () => {
  const doc = "- [ ] one\n- [ ] two\n- [ ] three";
  const state = runCommand(
    listAwareIndentMore,
    listStateFromText(doc, { from: doc.indexOf("- [ ] two"), to: doc.length }),
  );

  assert.equal(state.doc.toString(), "- [ ] one\n    - [ ] two\n    - [ ] three");
  assert.deepEqual(listItemIndents(state), [0, 4, 4]);
});

test("indenting the first task item is a no-op instead of creating an indented code block", () => {
  const state = runHandledCommand(listAwareIndentMore, listState("|- [ ] first\n- [ ] second"));

  assert.equal(state.doc.toString(), "- [ ] first\n- [ ] second");
  assert.deepEqual(listItemIndents(state), [0, 0]);
});

test("indenting the first nested task item is a no-op without a previous sibling", () => {
  const state = runHandledCommand(listAwareIndentMore, listState("- [ ] parent\n    |- [ ] child\n    - [ ] sibling"));

  assert.equal(state.doc.toString(), "- [ ] parent\n    - [ ] child\n    - [ ] sibling");
  assert.deepEqual(listItemIndents(state), [0, 4, 4]);
});

test("dedenting a nested task item restores the parent list indentation", () => {
  const state = runCommand(listAwareIndentLess, listState("- [ ] parent\n    |- [ ] child"));

  assert.equal(state.doc.toString(), "- [ ] parent\n- [ ] child");
  assert.deepEqual(listItemIndents(state), [0, 0]);
});

test("dedenting a top-level task item is a no-op", () => {
  const state = runHandledCommand(listAwareIndentLess, listState("|- [ ] first\n- [ ] second"));

  assert.equal(state.doc.toString(), "- [ ] first\n- [ ] second");
  assert.deepEqual(listItemIndents(state), [0, 0]);
});

test("Enter continues task and ordered list markers", () => {
  const task = runListKey("- [x] done|", "Enter");
  const ordered = runListKey("3. item|", "Enter");

  assert.equal(task.handled, true);
  assert.equal(task.state.doc.toString(), "- [x] done\n- [ ] ");
  assert.equal(ordered.handled, true);
  assert.equal(ordered.state.doc.toString(), "3. item\n4. ");
});

test("Enter preserves bullet variants and ordered closing-parenthesis markers", () => {
  for (const marker of ["+", "*"]) {
    const result = runListKey(`${marker} item|`, "Enter");
    assert.equal(result.handled, true);
    assert.equal(result.state.doc.toString(), `${marker} item\n${marker} `);
  }

  const ordered = runListKey("7) item|", "Enter");
  assert.equal(ordered.handled, true);
  assert.equal(ordered.state.doc.toString(), "7) item\n8) ");
});

test("Enter continues ordered tasks and multiline list items", () => {
  const orderedTask = runListKey("3. [x] done|", "Enter");
  const multiline = runListKey("- first line\n  continuation|", "Enter");

  assert.equal(orderedTask.state.doc.toString(), "3. [x] done\n4. [ ] ");
  assert.equal(multiline.state.doc.toString(), "- first line\n  continuation\n- ");
});

test("Enter continues task and ordered markers from multiline list content", () => {
  const task = runListKey("- [x] first line\n  continuation|", "Enter");
  const compactTask = runListKey("- [x]first line\n  continuation|", "Enter");
  const ordered = runListKey("3. first line\n   continuation|", "Enter");

  assert.equal(task.state.doc.toString(), "- [x] first line\n  continuation\n- [ ] ");
  assert.equal(compactTask.state.doc.toString(), "- [x]first line\n  continuation\n- [ ] ");
  assert.equal(ordered.state.doc.toString(), "3. first line\n   continuation\n4. ");
});

test("Enter removes trailing whitespace before continuing a list", () => {
  const { handled, state } = runListKey("- item   |", "Enter");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "- item\n- ");
});

test("Enter exits an empty top-level list item", () => {
  const { handled, state } = runListKey("- [ ] |", "Enter");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "");
  assert.equal(state.selection.main.head, 0);
});

test("Enter dedents an empty nested list item", () => {
  const { handled, state } = runListKey("- parent\n    - |", "Enter");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "- parent\n- ");
  assert.equal(state.selection.main.head, state.doc.length);
});

test("Enter leaves non-list text to CodeMirror", () => {
  const { handled, state } = runListKey("plain text|", "Enter");

  assert.equal(handled, false);
  assert.equal(state.doc.toString(), "plain text");
});

test("Enter declines selections, mid-line carets, and active search overlays", () => {
  assert.equal(runListKey("pl[ai]n", "Enter").handled, false);
  assert.equal(runListKey("- it|em", "Enter").handled, false);

  assert.equal(runListKey("- item|", "Enter", true).handled, false);
});

test("list commands decline multiple empty selections", () => {
  const doc = "- first\n- second";
  const state = EditorState.create({
    doc,
    selection: EditorSelection.create([EditorSelection.cursor("- first".length), EditorSelection.cursor(doc.length)]),
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdown({ base: markdownLanguage, extensions: [TaskList] }),
      createListsExtension(() => false),
    ],
  });
  const { view } = mutableFakeView(state);
  const enter = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === "Enter");
  const backspace = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === "Backspace");

  assert.equal(enter?.run?.(view), false);
  assert.equal(backspace?.run?.(view), false);
  assert.equal(view.state.doc.toString(), doc);
});

test("Backspace edits task marker source one character at a time", () => {
  const { handled, state } = runListKey("- [ |] task", "Backspace");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "- [] task");
});

test("Backspace leaves non-marker positions to CodeMirror", () => {
  assert.equal(runListKey("plain|", "Backspace").handled, false);
  assert.equal(runListKey("- |[ ] task", "Backspace").handled, false);
});

test("list-aware indentation falls back to normal indentation outside lists", () => {
  const indented = runCommand(listAwareIndentMore, listState("|plain"));
  const dedented = runCommand(
    listAwareIndentLess,
    listStateFromText(indented.doc.toString(), { from: indented.doc.length, to: indented.doc.length }),
  );

  assert.equal(indented.doc.toString(), "    plain");
  assert.equal(dedented.doc.toString(), "plain");
});

test("editing an ordered marker renumbers the following siblings from that marker", () => {
  const doc = "1. one\n2. two\n3. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 1, insert: "7" } });

  assert.equal(view.state.doc.toString(), "1. one\n7. two\n8. three");
});

test("editing a blockquoted ordered marker renumbers only its following siblings", () => {
  const doc = "> 1. one\n> 2. two\n> 3. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 1, insert: "7" } });

  assert.equal(view.state.doc.toString(), "> 1. one\n> 7. two\n> 8. three");
});

test("editing a nested ordered marker leaves the outer list numbering unchanged", () => {
  const doc = "1. outer\n   1. nested\n   2. second\n   3. third\n2. sibling";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));
  const marker = doc.indexOf("2. second");

  view.dispatch({ changes: { from: marker, to: marker + 1, insert: "7" } });

  assert.equal(view.state.doc.toString(), "1. outer\n   1. nested\n   7. second\n   8. third\n2. sibling");
});

test("deleting a digit from an ordered marker anchors numbering at the edited value", () => {
  const doc = "10. one\n11. two\n12. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));

  view.dispatch({ changes: { from: 1, to: 2 } });

  assert.equal(view.state.doc.toString(), "1. one\n2. two\n3. three");
});

test("deleting the leading digit of an ordered marker keeps the surviving marker as the anchor", () => {
  const doc = "10. one\n11. two\n12. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));

  view.dispatch({ changes: { from: 0, to: 1 } });

  assert.equal(view.state.doc.toString(), "0. one\n1. two\n2. three");
});

test("deleting the first ordered item restarts the surviving list at its number", () => {
  const doc = "1. one\n2. two\n3. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));

  view.dispatch({ changes: { from: 0, to: doc.indexOf("2.") } });

  assert.equal(view.state.doc.toString(), "1. two\n2. three");
});

test("breaking the first ordered item preserves a numbered list for the surviving siblings", () => {
  const doc = "1. one\n2. two\n3. three";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));

  view.dispatch({ changes: { from: 0, to: 2, insert: "paragraph" } });

  assert.equal(view.state.doc.toString(), "paragraph one\n1. two\n2. three");
});

test("breaking the final ordered marker does not disturb earlier siblings", () => {
  const doc = "1. one\n2. two";
  const { view } = mutableFakeView(listExtensionState(`${doc}|`));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 2, insert: "plain" } });

  assert.equal(view.state.doc.toString(), "1. one\nplain two");
});

test("transactions unrelated to ordered markers pass through unchanged", () => {
  const { view } = mutableFakeView(listExtensionState("1. one\n2. two|"));

  view.dispatch({ selection: { anchor: 0 } });
  view.dispatch({ changes: { from: 3, to: 6, insert: "first" } });

  assert.equal(view.state.doc.toString(), "1. first\n2. two");
});

test("unrelated newlines do not trigger ordered-list analysis", () => {
  const state = listStateFromText("paragraph\n\n1. one\n2. two", { from: 0, to: 0 });
  const paragraphEdit = state.update({ changes: { from: 4, insert: "\n" } });
  const listEdit = state.update({ changes: { from: state.doc.toString().indexOf("one") + 1, insert: "\n" } });
  const pastedList = state.update({ changes: { from: 0, insert: "before\n3. three\nafter\n" } });

  assert.equal(transactionMayTouchOrderedListMarker(paragraphEdit), false);
  assert.equal(transactionMayTouchOrderedListMarker(listEdit), true);
  assert.equal(transactionMayTouchOrderedListMarker(pastedList), true);
});

test("ordered-list renumbering preserves custom transaction annotations", () => {
  const metadata = Annotation.define<string>();
  const observedMetadata = StateField.define<string | null>({
    create: () => null,
    update: (value, transaction) => transaction.annotation(metadata) ?? value,
  });
  const state = EditorState.create({
    doc: "1. one\n2. two\n3. three",
    extensions: [
      markdown({ base: markdownLanguage, extensions: [TaskList] }),
      indentUnit.of("    "),
      observedMetadata,
      createListsExtension(() => false),
    ],
  });
  const { view } = mutableFakeView(state);
  const marker = view.state.doc.toString().indexOf("2.");

  view.dispatch({
    changes: { from: marker, to: marker + 1, insert: "7" },
    annotations: metadata.of("keep-me"),
  });

  assert.equal(view.state.doc.toString(), "1. one\n7. two\n8. three");
  assert.equal(view.state.field(observedMetadata), "keep-me");
});

test("Tab renumbering preserves its user-event annotation", () => {
  const observedUserEvent = StateField.define<string | null>({
    create: () => null,
    update: (value, transaction) => (transaction.isUserEvent("input.indent") ? "input.indent" : value),
  });
  const { text, selection } = marked("1. parent\n|2. child\n3. sibling");
  const state = EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [TaskList] }),
      indentUnit.of("    "),
      observedUserEvent,
      createListsExtension(() => false),
    ],
  });
  const { view } = mutableFakeView(state);
  const binding = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === "Tab");

  assert.equal(binding?.run?.(view), true);
  assert.equal(view.state.doc.toString(), "1. parent\n   1. child\n2. sibling");
  assert.equal(view.state.field(observedUserEvent), "input.indent");
});

test("Tab and Shift-Tab preserve ordered numbering across nesting changes", () => {
  const indented = runListKey("1. parent\n|2. child\n3. sibling", "Tab");

  assert.equal(indented.handled, true);
  assert.equal(indented.state.doc.toString(), "1. parent\n   1. child\n2. sibling");

  const dedented = runListKey("1. parent\n   1. child|", "Shift-Tab");

  assert.equal(dedented.handled, true);
  assert.equal(dedented.state.doc.toString(), "1. parent\n2. child");
});

test("Tab handles a list item that cannot be nested as an intentional no-op", () => {
  const { handled, state } = runListKey("|- first", "Tab");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "- first");
});

test("indenting a normal bullet item uses the editor's unordered-list indent width", () => {
  const state = runCommand(listAwareIndentMore, listState("- parent\n|- child"));

  assert.equal(state.doc.toString(), "- parent\n    - child");
  assert.deepEqual(listItemIndents(state), [0, 4]);
});

test("inactive indented task marker is replaced with a checkbox widget", () => {
  const taskRanges = listRanges("- [ ] parent\n    - [ ] child|");
  const taskStyles = rangesWithClass(taskRanges, "cm-list-line").map((range) => range.style);

  assert.deepEqual(replacedTexts(taskRanges), ["- [ ]", "- [ ]"]);
  assert.match(taskStyles[0], /padding-left: calc\(6px \+ 3ch\); text-indent: -3ch/);
  assert.match(taskStyles[1], /padding-left: calc\(6px \+ 7ch\); text-indent: -7ch/);
});

test("active indented task marker shows the task marker source", () => {
  const ranges = listRanges("- [ ] parent\n    - [| ] child");

  assert.deepEqual(replacedTexts(ranges), ["- [ ]"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-task-marker"), ["[ ]"]);
});

test("unchecked and checked task markers use checkbox widgets", () => {
  for (const marker of ["[ ]", "[x]", "[X]"]) {
    const ranges = listRanges(`|\n- ${marker} task`);

    assert.deepEqual(replacedTexts(ranges), [`- ${marker}`]);
    assert.deepEqual(ranges.map((range) => range.widgetName).filter(Boolean), ["TaskMarkerWidget"]);
  }
});

test("checked task content is styled only while the marker is replaced", () => {
  const inactive = listRanges("|\n- [x] completed");
  const active = listRanges("- [|x] completed");

  assert.deepEqual(textsWithClass(inactive, "cm-task-list-content-checked"), ["completed"]);
  assert.deepEqual(textsWithClass(active, "cm-task-list-content-checked"), []);
});

test("task marker selection reveals syntax without affecting sibling tasks", () => {
  const doc = "- [ ] first\n- [x] second";
  const secondMarker = doc.lastIndexOf("[x]");
  const ranges = rangesForState(
    buildListDecorations,
    listStateFromText(doc, { from: secondMarker, to: secondMarker + 3 }),
  );

  assert.deepEqual(replacedTexts(ranges), ["- [ ]"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-task-marker"), ["[x]"]);
});

test("ordered and blockquoted task markers preserve their structural prefix", () => {
  const ranges = listRanges("|\n1. [ ] ordered\n> - [x] quoted");

  assert.deepEqual(replacedTexts(ranges), ["1. [ ]", "- [x]"]);
});

test("task-like text without separating content whitespace is not replaced", () => {
  assert.deepEqual(replacedTexts(listRanges("|\n- [ ]\n- [x]compact\nplain [ ] text")), []);
});

test("ordinary list items use their actual content column for line layout", () => {
  const bullet = rangesWithClass(listRanges("|\n- item"), "cm-list-line");
  const ordered = rangesWithClass(listRanges("|\n10. ordered"), "cm-list-line");

  assert.equal(bullet[0].style, "padding-left: calc(6px + 2ch); text-indent: -2ch");
  assert.equal(ordered[0].style, "padding-left: calc(6px + 4ch); text-indent: -4ch");
});

test("lazy list continuation wraps at its source indentation without a guide through its text", () => {
  const lines = rangesWithClass(
    listRanges(
      "|\n# Examples\n1. **Masquerading / Spoofing**\nMasquerading is an attack in which attacker pretends to be a *legitimate, authorized user or entity* in order to gain access to a system or resources. Happens at higher levels.",
    ),
    "cm-list-line",
  );

  assert.equal(lines[0].style, "padding-left: calc(6px + 3ch); text-indent: -3ch");
  assert.equal(lines[1].style, "padding-left: calc(6px + 0ch); text-indent: -0ch");
});

test("partially indented lazy continuation wraps at its own indentation", () => {
  const lines = rangesWithClass(listRanges("|\n1. title\n  continuation\n   regular continuation"), "cm-list-line");

  assert.equal(lines[1].style, "padding-left: calc(6px + 2ch); text-indent: -2ch");
  assert.match(lines[2].style, /^padding-left: calc\(6px \+ 3ch\); text-indent: -3ch;/);
});

test("tab-indented list items use visual columns for line layout", () => {
  const ordinary = rangesWithClass(listRanges("|\n- parent\n\t- item"), "cm-list-line");
  const task = rangesWithClass(listRanges("|\n- parent\n\t- [ ] task"), "cm-list-line");

  assert.match(ordinary[1].style, /padding-left: calc\(6px \+ 6ch\); text-indent: -6ch/);
  assert.match(task[1].style, /padding-left: calc\(6px \+ 7ch\); text-indent: -7ch/);
});

test("tab-indented child lists render one indentation guide", () => {
  const ranges = rangesWithClass(listRanges("|\n- parent\n\t- child"), "cm-list-line");

  assert.match(ranges[1].style, /background-image/);
  assert.match(ranges[1].style, /calc\(6px \+ 0\.5ch\)/);
});

test("task guides follow actual two-space ancestor indentation and checkbox centers", () => {
  const ranges = rangesWithClass(
    listRanges("|\n- [ ] parent\n  - [ ] child\n    - [ ] grandchild\n  - [x] sibling\n- [ ] next"),
    "cm-list-line",
  );
  assert.doesNotMatch(ranges[0].style, /background-image/);
  assert.match(ranges[1].style, /background-position: calc\(6px \+ 0ch \+ 0.49em\) 0/);
  assert.match(ranges[2].style, /background-position: calc\(6px \+ 0ch \+ 0.49em\) 0, calc\(6px \+ 2ch \+ 0.49em\) 0/);
  assert.match(ranges[3].style, /background-size: 1px 100%;/);
  assert.doesNotMatch(ranges[4].style, /background-image/);
});

test("mixed list guides retain each ancestor's marker position across variable indentation", () => {
  const ranges = rangesWithClass(listRanges("|\n- bullet\n  - [ ] task\n      - nested"), "cm-list-line");
  assert.match(ranges[2].style, /background-position: calc\(6px \+ 0.5ch\) 0, calc\(6px \+ 2ch \+ 0.49em\) 0/);
});
