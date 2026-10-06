import { test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { TaskList } from "@lezer/markdown";

import {
  buildListDecorations,
  createListsExtension,
} from "../src/renderer/src/features/editor/extensions/ListsExtension";
import { marked, mutableFakeView, rangesForState } from "./cm-extension-test-utils";

// Adversarial suite for the list extensions (see specs/agent/worksheet-lists-adversarial-hardening.md).
//
// Layers:
// 1. Seeded fuzz: random list-heavy documents receive random typing/deleting/snippet edits. The
//    extension must never throw, must keep selections in bounds, and (once KNOWN BUG L1 is fixed)
//    may only ever rewrite text the markdown parser itself sees as an ordered-list ListMark.
//    Undo/redo round-trips are covered with a real EditorView in lists-undo-integrity.vitest.ts;
//    the fake view used here does not compose history events the way a real dispatch does.
// 2. Structured attacks. Verified corruption bugs use test.fails so the suite stays green today
//    while asserting the DESIRED behavior: when the bug is fixed the test starts failing and must
//    be flipped to a regular test. Verified quirky-but-defensible behavior is pinned as regular
//    tests with commentary so silent changes get noticed.

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

function rawListState(text: string, position = 0) {
  return stateFrom(text, { from: position, to: position }, listExtensions());
}

function pureStateFromText(text: string, position = 0) {
  return stateFrom(text, { from: position, to: position }, pureExtensions());
}

function runKey(input: string, key: string) {
  const { view } = mutableFakeView(listState(input));
  const binding = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === key);

  assert.ok(binding?.run, `${key} binding should be registered`);
  const handled = binding.run(view);

  return { handled, state: view.state };
}

function orderedMarkRanges(state: EditorState) {
  const orderedListRanges: { from: number; to: number }[] = [];
  const marks: { from: number; to: number }[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "OrderedList") orderedListRanges.push({ from: node.from, to: node.to });
      if (node.name === "ListMark") marks.push({ from: node.from, to: node.to });
    },
  });

  const orderedMarks = marks.filter((mark) =>
    orderedListRanges.some((list) => list.from <= mark.from && mark.to <= list.to),
  );
  return { orderedMarks, orderedListRanges };
}

function codeRanges(state: EditorState) {
  const ranges: { from: number; to: number }[] = [];

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "FencedCode" || node.name === "CodeText" || node.name === "CodeBlock") {
        ranges.push({ from: node.from, to: node.to });
      }
    },
  });

  return ranges;
}

function isCovered(position: { from: number; to: number }, ranges: readonly { from: number; to: number }[]) {
  return ranges.some((range) => range.from <= position.from && position.to <= range.to);
}

type DiffRegion = { from: number; to: number; bLine: string };

// Line-level diff with sub-line refinement: renumbering replaces marker text in place, so changed
// line pairs reduce to the differing middle of the line.
function diffRegions(a: string, b: string): DiffRegion[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;

  for (const line of aLines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type Op = { kind: "same" | "deleteA" | "insertB"; i: number; j: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ kind: "same", i, j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "deleteA", i, j });
      i++;
    } else {
      ops.push({ kind: "insertB", i, j });
      j++;
    }
  }

  while (i < n) {
    ops.push({ kind: "deleteA", i, j: m });
    i++;
  }

  const regions: DiffRegion[] = [];
  let index = 0;

  while (index < ops.length) {
    if (ops[index].kind !== "deleteA") {
      index++;
      continue;
    }

    const deleted: number[] = [];
    while (index < ops.length && ops[index].kind === "deleteA") {
      deleted.push(ops[index].i);
      index++;
    }

    const inserted: number[] = [];
    while (index < ops.length && ops[index].kind === "insertB") {
      inserted.push(ops[index].j);
      index++;
    }

    deleted.forEach((aIndex, pairIndex) => {
      const bIndex = inserted[pairIndex];
      const aLine = aLines[aIndex];
      const region = { from: lineStarts[aIndex], to: lineStarts[aIndex] + aLine.length, bLine: "" };

      if (bIndex === undefined) {
        regions.push(region);
        return;
      }

      const bLine = bLines[bIndex];
      region.bLine = bLine;

      let prefix = 0;
      while (prefix < aLine.length && prefix < bLine.length && aLine[prefix] === bLine[prefix]) prefix++;

      let suffix = 0;
      while (
        suffix < aLine.length - prefix &&
        suffix < bLine.length - prefix &&
        aLine[aLine.length - 1 - suffix] === bLine[bLine.length - 1 - suffix]
      ) {
        suffix++;
      }

      region.from += prefix;
      region.to -= suffix;
      if (region.to > region.from) regions.push(region);
    });
  }

  return regions;
}

function assertSelectionWithinBounds(state: EditorState) {
  for (const range of state.selection.ranges) {
    assert.ok(Number.isFinite(range.from) && Number.isFinite(range.to), "selection must be finite");
    assert.ok(range.from >= 0 && range.to <= state.doc.length, "selection must stay inside the document");
    assert.ok(range.from <= range.to, "selection must stay ordered");
  }
}

function mulberry32(seed: number) {
  let seedState = seed >>> 0;

  return () => {
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOC_FRAGMENTS = [
  "- bullet\n- list\n- items",
  "1. one\n2. two\n3. three",
  "- [ ] task\n- [x] done\n- [ ] more",
  "10. a\n11. b",
  "1) paren\n2) marks",
  "> - quoted\n> - items",
  "> 1. quoted ordered\n> 2. list",
  "- parent\n    - child\n        - grandchild",
  "1. outer\n   1. inner\n   2. inner2\n2. sibling",
  "```\nfenced text\n```\n1. after fence",
  "paragraph text\nmore text",
  "- \n- ",
  "007. zeros\n8. more",
  "- trailing spaces   ",
  "5. custom\n6. numbers",
  "999999999. big",
  // Mixed-type nesting and soft-break continuation shapes (mixed-list interaction gate).
  "- outer\n  1. inner\n  2. inner2",
  "1. outer\n   - inner\n   - inner2",
  "- Some text\n  some other text\n    - Another list mark",
  "1. Some text\n   some another text\n   1. dasdsad a",
  "- a\n  continuation\n- b",
];

const INSERTIONS = ["1", "2", "7", "0", ".", ")", "-", "*", "+", "[", "]", "x", " ", "\t", "\n", ">", "`", "#", "\\"];
const SNIPPETS = ["1. ", "2. ", "10. ", "- ", "> ", "```", "    ", "\n1. a", "\n- b", "\n> - c"];

function randomEdit(random: () => number, doc: string) {
  const position = Math.floor(random() * (doc.length + 1));
  const roll = random();

  if (roll < 0.45) {
    const insert = INSERTIONS[Math.floor(random() * INSERTIONS.length)];
    return {
      changes: { from: position, to: position, insert },
      label: `insert ${JSON.stringify(insert)} @${position}`,
    };
  }

  if (roll < 0.7) {
    const length = Math.min(1 + Math.floor(random() * 3), doc.length - position);
    if (length <= 0) return { changes: { from: position, to: position, insert: "" }, label: "noop" };
    return { changes: { from: position, to: position + length, insert: "" }, label: `delete ${length} @${position}` };
  }

  const snippet = SNIPPETS[Math.floor(random() * SNIPPETS.length)];
  return {
    changes: { from: position, to: position, insert: snippet },
    label: `snippet ${JSON.stringify(snippet)} @${position}`,
  };
}

function runFuzz(seed: number, iterations: number, checkDifferential: boolean) {
  const random = mulberry32(seed);

  for (let iteration = 0; iteration < iterations; iteration++) {
    const fragmentCount = 1 + Math.floor(random() * 3);
    const parts: string[] = [];

    for (let fragment = 0; fragment < fragmentCount; fragment++) {
      parts.push(DOC_FRAGMENTS[Math.floor(random() * DOC_FRAGMENTS.length)]);
    }

    let doc = parts.join("\n\n");
    if (doc.length > 420) doc = doc.slice(0, 420);

    const ext = mutableFakeView(rawListState(doc));
    const pure = mutableFakeView(pureStateFromText(doc));

    const stepCount = 1 + Math.floor(random() * 4);

    for (let step = 0; step < stepCount; step++) {
      const spec = randomEdit(random, ext.view.state.doc.toString());
      const before = ext.view.state.doc.toString();

      let extError: unknown = null;
      try {
        ext.view.dispatch({ changes: spec.changes });
      } catch (error) {
        extError = error;
      }

      assert.equal(
        extError,
        null,
        `seed ${seed} iteration ${iteration} step ${step} (${spec.label}) threw on doc ${JSON.stringify(before)}`,
      );

      assertSelectionWithinBounds(ext.view.state);

      if (!checkDifferential) continue;

      // The extension may legitimately change document length (marker rewrites), so a position
      // derived from the ext doc can fall outside the pure doc; skip such steps, the documents
      // have already diverged and are not comparable.
      const pureLength = pure.view.state.doc.length;
      const changeTo = spec.changes.to ?? spec.changes.from ?? 0;
      if (changeTo > pureLength) continue;

      pure.view.dispatch({ changes: spec.changes });

      const pureDoc = pure.view.state.doc.toString();
      const regions = diffRegions(pureDoc, ext.view.state.doc.toString());
      const { orderedMarks } = orderedMarkRanges(pure.view.state);

      for (const region of regions) {
        const context = `seed ${seed} iteration ${iteration} step ${step} (${spec.label})\n  before: ${JSON.stringify(before)}\n  pure:   ${JSON.stringify(pureDoc)}\n  ext:    ${JSON.stringify(ext.view.state.doc.toString())}\n  region: ${JSON.stringify(pureDoc.slice(region.from, region.to))} -> ${JSON.stringify(region.bLine)}`;
        assert.ok(
          region.from < region.to ? isCovered(region, orderedMarks) : true,
          `lists extension changed text outside parsed ordered-list markers\n${context}`,
        );
      }
    }
  }
}

test("fuzz: list edits never throw and keep selections in bounds (seed 0x51a7)", () => {
  runFuzz(0x51a7, 60, false);
});

test("fuzz: list edits never throw and keep selections in bounds (seed 0x0b1e)", () => {
  runFuzz(0x0b1e, 60, false);
});

// KNOWN BUG (L1, worksheet): the renumber filter's line-based bookkeeping rewrites text the parser
// does not treat as an ordered-list marker — code-fence contents and marker-LOOKING item content.
// This strict differential fails today; when the raw-text fallback is fixed, flip these to regular
// tests (they must pass then).
test.fails("fuzz: list edits only ever rewrite parsed ordered-list markers (seed 0x51a7)", () => {
  runFuzz(0x51a7, 60, true);
});

test.fails("fuzz: list edits only ever rewrite parsed ordered-list markers (seed 0x0b1e)", () => {
  runFuzz(0x0b1e, 60, true);
});

// ---------------------------------------------------------------------------
// KNOWN CORRUPTION BUGS — `fails` asserts the desired behavior, which does not
// hold yet. When one of these starts failing, the bug was fixed: flip it to a
// regular test.
// ---------------------------------------------------------------------------

test.fails("KNOWN BUG L1: opening a code fence above a list never rewrites the numbers inside the fence", () => {
  const { view } = mutableFakeView(listState("|1. a\n2. b"));

  view.dispatch({ changes: { from: 0, insert: "```\n" } });

  assert.equal(view.state.doc.toString(), "```\n1. a\n2. b");
});

test.fails("KNOWN BUG L2: Tab inside a quoted list keeps every selected line inside the blockquote", () => {
  const { handled, state } = runKey("> - parent\n> |- child", "Tab");

  assert.equal(handled, true);
  assert.match(state.doc.line(2).text, /^>[ \t]*- child/);
});

test.fails("KNOWN BUG L2: Shift-Tab inside a quoted list keeps the dedented line inside the blockquote", () => {
  const { handled, state } = runKey("> - parent\n> \t|- child", "Shift-Tab");

  assert.equal(handled, true);
  assert.match(state.doc.line(2).text, /^>[ \t]*- child/);
});

test.fails("KNOWN BUG L3: Enter after a custom start number preserves the custom numbers", () => {
  const { state } = runKey("1. one\n7. two\n8. three|", "Enter");

  assert.equal(state.doc.toString(), "1. one\n7. two\n8. three\n9. ");
});

test.fails("KNOWN BUG L4: continuing a list never creates a marker CommonMark no longer parses as a list", () => {
  const { state } = runKey("999999999. big|", "Enter");
  const lastLine = state.doc.line(state.doc.lines);
  const lastState = pureStateFromText(state.doc.toString(), lastLine.from);
  const { orderedMarks } = orderedMarkRanges(lastState);
  const lastLineHasMark = orderedMarks.some((mark) => mark.from >= lastLine.from && mark.to <= lastLine.to);

  assert.equal(lastLineHasMark, true);
});

// ---------------------------------------------------------------------------
// Verified sharp edges pinned as current behavior.
// ---------------------------------------------------------------------------

test("Enter in a quoted list continues from a continuation line but not from the marker line", () => {
  const fromMarker = runKey("> - item|", "Enter");
  assert.equal(fromMarker.handled, false);

  const fromContinuation = runKey("> - first\n>   cont|", "Enter");
  assert.equal(fromContinuation.handled, true);
  assert.equal(fromContinuation.state.doc.toString(), "> - first\n>   cont\n> - ");
});

test("Enter on an empty quoted marker line declines instead of exiting the item", () => {
  const { handled, state } = runKey("> - |", "Enter");

  assert.equal(handled, false);
  assert.equal(state.doc.toString(), "> - ");
});

test("Tab over a selection mixing list and plain lines indents only the list lines", () => {
  const doc = "- a\nplain";
  const { view } = mutableFakeView(stateFrom(doc, { from: 0, to: doc.length }, listExtensions()));
  const binding = view.state
    .facet(keymap)
    .flat()
    .find((candidate) => candidate.key === "Tab");

  assert.equal(binding?.run?.(view), true);
  assert.equal(view.state.doc.toString(), "- a\nplain");
});

test("Enter normalizes a leading-zero ordered marker", () => {
  const { state } = runKey("007. a|", "Enter");

  assert.equal(state.doc.toString(), "7. a\n8. ");
});

test("merging two lists by deleting the blank line between them keeps their numbers", () => {
  const doc = "1. a\n\n5. b\n6. c";
  const { view } = mutableFakeView(rawListState(doc));

  view.dispatch({ changes: { from: 5, to: 6, insert: "" } });

  assert.equal(view.state.doc.toString(), "1. a\n5. b\n6. c");
});

test("markers with ten or more digits are not lists, and list commands decline on them", () => {
  const enter = runKey("9007199254740994. a|", "Enter");
  assert.equal(enter.handled, false);
  assert.equal(enter.state.doc.toString(), "9007199254740994. a");
});

test("renumbering crosses blank lines inside a loose ordered list", () => {
  const doc = "1. a\n2. b\n\n3. other";
  const { view } = mutableFakeView(rawListState(doc));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 1, insert: "8" } });

  assert.equal(view.state.doc.toString(), "1. a\n8. b\n\n9. other");
});

test("changing an ordered delimiter splits the list instead of renumbering across delimiters", () => {
  const doc = "1. a\n2. b";
  const { view } = mutableFakeView(rawListState(doc));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 2, insert: "2)" } });

  assert.equal(view.state.doc.toString(), "1. a\n2) b");
});

test("marker edits in one list leave a separate later list untouched", () => {
  const doc = "1. a\n2. b\n\ntext\n\n1. x\n2. y";
  const { view } = mutableFakeView(rawListState(doc));
  const marker = doc.indexOf("2.");

  view.dispatch({ changes: { from: marker, to: marker + 1, insert: "9" } });

  assert.equal(view.state.doc.toString(), "1. a\n9. b\n\ntext\n\n1. x\n2. y");
});

test("decorations never replace list markers inside fenced code", () => {
  const state = rawListState("```\n- not a list\n- also not\n```\n\n- real item");
  const ranges = rangesForState(buildListDecorations, state);
  const fences = codeRanges(state);

  for (const range of ranges) {
    if (range.widgetName !== null) {
      assert.ok(!isCovered(range, fences), `widget ${range.widgetName} rendered inside a code fence at ${range.from}`);
    }
  }

  assert.ok(ranges.some((range) => range.widgetName === "BulletMarkerWidget"));
});

test("decorations survive pathological documents without throwing", () => {
  const pathological = [
    "- \t\n-\n- [ ]\n- [x]compact\n> - q\n> \t- n\n1.\n007. a\n\t- t\n1. [ ] o\n- a\n\n\n1. after",
    "> > > - deep\n> > > \t- deeper\n1. [x] t\n   2. [ ] u",
    "```\n- [ ]\n```\n1. x\n\n1. y",
    "- ",
  ];

  for (const doc of pathological) {
    const state = rawListState(doc);
    assert.doesNotThrow(() => rangesForState(buildListDecorations, state));
  }
});

test("empty item markers of every flavor exit consistently on Enter", () => {
  for (const marker of ["-", "+", "*", "3.", "3)", "- [ ]", "1. [ ]"]) {
    const { handled, state } = runKey(`${marker} |`, "Enter");

    assert.equal(handled, true, `Enter on an empty top-level marker ${JSON.stringify(marker)} should be handled`);
    assert.equal(
      state.doc.toString(),
      "",
      `Enter on an empty top-level marker ${JSON.stringify(marker)} should clear the line`,
    );
  }
});

test("Backspace edits a quoted task marker source one character at a time", () => {
  const { handled, state } = runKey("> - [ |] task", "Backspace");

  assert.equal(handled, true);
  assert.equal(state.doc.toString(), "> - [] task");
});
