import { EditorSelection, EditorState } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { expect, test } from "vitest";

import { isMathBlockLine } from "../src/renderer/src/features/editor/extensions/MathExpression";
import {
  moveDownIntoTargetLine,
  moveUpFromVisualLineStart,
  moveUpIntoTargetLine,
  targetLineNavigationKeymap,
} from "../src/renderer/src/features/editor/extensions/shared/lineNavigation";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import { mutableFakeView } from "./cm-extension-test-utils";

const doc = "abcdef\n$$\nabcdefghij\n$$\nafter text";

test("ArrowUp moves from the rendered start of a wrapped row", () => {
  const position = 8;
  const { view } = mutableFakeView(EditorState.create({ doc: "previous wrapped row" }));
  view.dispatch({
    selection: EditorSelection.create([EditorSelection.cursor(position, 0, undefined, 12)]),
  });
  let startingAssociation: number | undefined;

  Object.assign(view, {
    coordsAtPos: (_position: number, side: number) =>
      side < 0 ? { bottom: 10, left: 100, right: 100, top: 0 } : { bottom: 30, left: 0, right: 0, top: 20 },
    moveVertically: (start: { assoc: number; goalColumn?: number }) => {
      startingAssociation = start.assoc;
      return EditorSelection.cursor(2, 1, undefined, start.goalColumn);
    },
  });

  expect(moveUpFromVisualLineStart(view)).toBe(true);
  expect(startingAssociation).toBe(1);
  expect(view.state.selection.main).toMatchObject({ assoc: 1, goalColumn: 12, head: 2 });
});

test("ArrowUp leaves ordinary caret positions to CodeMirror", () => {
  const { view } = mutableFakeView(EditorState.create({ doc: "ordinary", selection: { anchor: 4 } }));
  let moved = false;

  Object.assign(view, {
    coordsAtPos: () => ({ bottom: 10, left: 4, right: 4, top: 0 }),
    moveVertically: () => {
      moved = true;
      return EditorSelection.cursor(0);
    },
  });

  expect(moveUpFromVisualLineStart(view)).toBe(false);
  expect(moved).toBe(false);
  expect(view.state.selection.main.head).toBe(4);
});

function mathView(lineNumber: number, column: number) {
  const initial = EditorState.create({ doc, extensions: [obimMarkdown()] });
  const line = initial.doc.line(lineNumber);
  return mutableFakeView(initial.update({ selection: { anchor: Math.min(line.to, line.from + column) } }).state).view;
}

function skipTo(lineNumber: number, column: number, goalColumn = 50) {
  return (view: EditorView) => {
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(Math.min(line.to, line.from + column), 1, undefined, goalColumn),
      ]),
    });
    return true;
  };
}

function selectionLocation(view: EditorView) {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.head);
  return {
    column: selection.head - line.from,
    goalColumn: selection.goalColumn,
    line: line.number,
  };
}

test("ArrowDown visits every hidden block-math line without losing its goal column", () => {
  const view = mathView(1, 5);

  for (const expected of [
    { line: 2, column: 2 },
    { line: 3, column: 5 },
    { line: 4, column: 2 },
  ]) {
    expect(moveDownIntoTargetLine(view, isMathBlockLine, skipTo(5, 5))).toBe(true);
    expect(selectionLocation(view)).toEqual({ ...expected, goalColumn: 50 });
  }
});

test("ArrowUp visits every hidden block-math line without losing its goal column", () => {
  const view = mathView(5, 5);

  for (const expected of [
    { line: 4, column: 2 },
    { line: 3, column: 5 },
    { line: 2, column: 2 },
  ]) {
    expect(moveUpIntoTargetLine(view, isMathBlockLine, skipTo(1, 5))).toBe(true);
    expect(selectionLocation(view)).toEqual({ ...expected, goalColumn: 50 });
  }
});

test("vertical navigation leaves ordinary lines to CodeMirror", () => {
  const view = mathView(5, 2);
  let called = false;

  expect(
    moveDownIntoTargetLine(view, isMathBlockLine, () => {
      called = true;
      return true;
    }),
  ).toBe(false);
  expect(called).toBe(false);
  expect(selectionLocation(view)).toEqual({ line: 5, column: 2, goalColumn: undefined });
});

test("vertical navigation does not rewrite non-empty selections", () => {
  const state = EditorState.create({
    doc,
    selection: { anchor: 1, head: 3 },
    extensions: [obimMarkdown()],
  });
  const { view } = mutableFakeView(state);

  expect(moveDownIntoTargetLine(view, isMathBlockLine, skipTo(5, 5))).toBe(false);
  expect({ from: view.state.selection.main.from, to: view.state.selection.main.to }).toEqual({ from: 1, to: 3 });
});

test("vertical navigation does nothing when CodeMirror cannot move", () => {
  const view = mathView(1, 3);

  expect(moveDownIntoTargetLine(view, isMathBlockLine, () => false)).toBe(false);
  expect(selectionLocation(view)).toEqual({ line: 1, column: 3, goalColumn: undefined });
});

test("vertical navigation keeps CodeMirror's result when it lands on the target line", () => {
  const view = mathView(1, 3);

  expect(
    moveDownIntoTargetLine(view, isMathBlockLine, (movingView) => {
      movingView.dispatch({ selection: { anchor: movingView.state.doc.line(2).to } });
      return true;
    }),
  ).toBe(true);
  expect(selectionLocation(view).line).toBe(2);
});

test("the target-line keymap delegates both vertical directions", () => {
  const { view } = mutableFakeView(
    EditorState.create({
      doc: "one\ntwo",
      extensions: [targetLineNavigationKeymap(() => false)],
    }),
  );
  const bindings = view.state.facet(keymap).flat();

  for (const key of ["ArrowUp", "ArrowDown"]) {
    const binding = bindings.find((candidate) => candidate.key === key);
    expect(binding?.run?.(view)).toBe(false);
  }
});

function decoratedLineView(doc: string, position: number, falseRowPosition: number) {
  const { view } = mutableFakeView(
    EditorState.create({
      doc,
      selection: { anchor: position },
      extensions: [obimMarkdown()],
    }),
  );

  Object.assign(view, {
    contentDOM: { getBoundingClientRect: () => ({ left: 0 }) },
    coordsAtPos: (pos: number) => ({
      bottom: pos === falseRowPosition ? 30 : 10,
      left: pos === falseRowPosition ? view.state.selection.main.head : pos,
      right: pos === falseRowPosition ? view.state.selection.main.head : pos,
      top: pos === falseRowPosition ? 20 : 0,
    }),
  });
  return view;
}

test("ArrowDown leaves a one-line task at its end instead of entering the replaced marker", () => {
  const doc = "- [ ] Item";
  const view = decoratedLineView(doc, doc.length, doc.indexOf("["));

  expect(moveDownIntoTargetLine(view, isMathBlockLine)).toBe(false);
  expect(view.state.selection.main.head).toBe(doc.length);
});

test("ArrowDown delegates wrapped prose containing inline math to CodeMirror", () => {
  const doc =
    "The **Metropolis algorithm** was introduced as a simulation of physical systems moving toward thermal equilibrium. For a physical state `i` with energy `E_i`, a small perturbation proposes a next state `j` with energy `E_j`. If the new state is better or equal $\\frac{x}{y}$:";
  const caret = doc.indexOf("equilibrium") + "equilibr".length;
  const view = decoratedLineView(doc, caret, doc.indexOf("$"));

  expect(moveDownIntoTargetLine(view, isMathBlockLine)).toBe(false);
  expect(view.state.selection.main.head).toBe(caret);
});

const widgetFragments = [
  "plain words",
  "**strong text**",
  "*emphasized text*",
  "`inline code`",
  "[linked note](note.md)",
  "![diagram](diagram.png)",
  "$\\frac{x}{y}$",
  "[external link](https://example.com)",
];
const linePrefixes = ["", "- [ ] ", "> ", "### "];
const generatedParagraphs = Array.from({ length: 128 }, (_, seed) => {
  const step = [1, 3, 5, 7][Math.floor(seed / widgetFragments.length) % 4];
  const fragments = widgetFragments.map(
    (_, offset) => widgetFragments[(seed + offset * step) % widgetFragments.length],
  );
  const doc = `${linePrefixes[Math.floor(seed / 32)]}${fragments.join(seed % 2 ? ", while " : " and ")}`;

  return {
    decoy: doc.indexOf(fragments[(seed * 5) % fragments.length]),
    doc,
    seed,
  };
});

test.each(generatedParagraphs)(
  "ArrowDown delegates every caret in generated decorated paragraph $seed",
  ({ decoy, doc }) => {
    const view = decoratedLineView(doc, 0, decoy);

    for (let caret = 0; caret <= doc.length; caret += 1) {
      view.dispatch({ selection: { anchor: caret } });
      expect(moveDownIntoTargetLine(view, isMathBlockLine)).toBe(false);
      expect(view.state.selection.main.head).toBe(caret);
    }
  },
);
