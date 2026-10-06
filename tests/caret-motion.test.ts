import assert from "node:assert/strict";

import { cursorCharBackwardLogical, cursorCharForwardLogical } from "@codemirror/commands";
import { EditorState, type StateCommand } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { expect, test } from "vitest";

import { buildBlockQuoteDecorations } from "../src/renderer/src/features/editor/extensions/BlockQuoteExtension";
import { buildCodeBlockDecorations } from "../src/renderer/src/features/editor/extensions/CodeBlockExtension";
import { buildEmphasisDecorations } from "../src/renderer/src/features/editor/extensions/EmphasisExtension";
import { buildHeadingDecorations } from "../src/renderer/src/features/editor/extensions/HeadingExtension";
import { buildHorizontalRuleDecorations } from "../src/renderer/src/features/editor/extensions/HorizontalRuleExtension";
import { buildImageDecorations } from "../src/renderer/src/features/editor/extensions/ImageExtension";
import { buildLinkDecorations } from "../src/renderer/src/features/editor/extensions/LinkExtension";
import { buildListDecorations } from "../src/renderer/src/features/editor/extensions/ListsExtension";
import { buildMathDecorations } from "../src/renderer/src/features/editor/extensions/MathExpression";
import { obimMarkdown } from "../src/renderer/src/features/editor/language";
import {
  fakeView,
  rangesForState,
  rangesWithClass,
  replacedTexts,
  textsWithClass,
  type DecorationRange,
} from "./cm-extension-test-utils";

type CaretCase = {
  activeSource: string;
  decorations: (state: EditorState) => DecorationSet;
  doc: string;
  name: string;
  syntaxIsVisible: (ranges: DecorationRange[]) => boolean;
};

const visibleClass = (className: string) => (ranges: DecorationRange[]) => textsWithClass(ranges, className).length > 0;

const noReplacement = (ranges: DecorationRange[]) => replacedTexts(ranges).length === 0;

const cases: CaretCase[] = [
  {
    name: "emphasis",
    doc: "before **bold** after",
    activeSource: "**bold**",
    decorations: (state) => buildEmphasisDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-emphasis-mark"),
  },
  {
    name: "nested emphasis",
    doc: "before ***bold italic*** after",
    activeSource: "***bold italic***",
    decorations: (state) => buildEmphasisDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-emphasis-mark"),
  },
  {
    name: "inline code",
    doc: "before `code` after",
    activeSource: "`code`",
    decorations: (state) => buildCodeBlockDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-inline-code-mark"),
  },
  {
    name: "double-backtick inline code",
    doc: "before ``code with ` tick`` after",
    activeSource: "``code with ` tick``",
    decorations: (state) => buildCodeBlockDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-inline-code-mark"),
  },
  {
    name: "ATX heading",
    doc: "before\n## heading ##\nafter",
    activeSource: "## heading ##",
    decorations: (state) => buildHeadingDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-heading-mark"),
  },
  {
    name: "setext heading",
    doc: "before\n\nheading\n---\nafter",
    activeSource: "heading\n---",
    decorations: (state) => buildHeadingDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-heading-mark"),
  },
  {
    name: "image",
    doc: "before ![alt](image.png) after",
    activeSource: "![alt](image.png)",
    decorations: (state) => buildImageDecorations(state),
    syntaxIsVisible: visibleClass("cm-formatting-image-mark"),
  },
  {
    name: "image with nested destination parentheses",
    doc: "before ![alt](folder/a_(b).png) after",
    activeSource: "![alt](folder/a_(b).png)",
    decorations: (state) => buildImageDecorations(state),
    syntaxIsVisible: visibleClass("cm-formatting-image-mark"),
  },
  {
    name: "link",
    doc: "before [label](note.md) after",
    activeSource: "[label](note.md)",
    decorations: (state) => buildLinkDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-link-mark"),
  },
  {
    name: "link with a spaced destination",
    doc: "before [label](folder/note one.md) after",
    activeSource: "[label](folder/note one.md)",
    decorations: (state) => buildLinkDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-link-mark"),
  },
  {
    name: "inline math",
    doc: "before $x + 1$ after",
    activeSource: "$x + 1$",
    decorations: (state) => buildMathDecorations(state).decorations,
    syntaxIsVisible: visibleClass("cm-formatting-math-mark"),
  },
  {
    name: "task marker",
    doc: "before\n- [ ] task\nafter",
    activeSource: "- [ ]",
    decorations: (state) => buildListDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-task-marker"),
  },
  {
    name: "ordered checked-task marker",
    doc: "before\n\n10. [x] task\nafter",
    activeSource: "10. [x]",
    decorations: (state) => buildListDecorations(fakeView(state)),
    syntaxIsVisible: visibleClass("cm-formatting-task-marker"),
  },
  {
    name: "horizontal rule",
    doc: "before\n\n---\nafter",
    activeSource: "---",
    decorations: (state) => buildHorizontalRuleDecorations(fakeView(state)),
    syntaxIsVisible: noReplacement,
  },
  {
    name: "spaced horizontal rule",
    doc: "before\n\n* * *\nafter",
    activeSource: "* * *",
    decorations: (state) => buildHorizontalRuleDecorations(fakeView(state)),
    syntaxIsVisible: noReplacement,
  },
  {
    name: "fenced code block",
    doc: "before\n```ts\nconst n = 1\n```\nafter",
    activeSource: "```ts\nconst n = 1\n```",
    decorations: (state) => buildCodeBlockDecorations(fakeView(state)),
    syntaxIsVisible: noReplacement,
  },
  {
    name: "tilde-fenced code block",
    doc: "before\n~~~js\nconst n = 1\n~~~\nafter",
    activeSource: "~~~js\nconst n = 1\n~~~",
    decorations: (state) => buildCodeBlockDecorations(fakeView(state)),
    syntaxIsVisible: noReplacement,
  },
  {
    name: "block math",
    doc: "before\n$$\nx + 1\n$$\nafter",
    activeSource: "$$\nx + 1\n$$",
    decorations: (state) => buildMathDecorations(state).decorations,
    syntaxIsVisible: visibleClass("cm-formatting-math-mark"),
  },
  {
    name: "single-line block math",
    doc: "before\n$$x + 1$$\nafter",
    activeSource: "$$x + 1$$",
    decorations: (state) => buildMathDecorations(state).decorations,
    syntaxIsVisible: visibleClass("cm-formatting-math-mark"),
  },
  {
    name: "blockquote",
    doc: "before\n\n> quote",
    activeSource: "> quote",
    decorations: (state) => buildBlockQuoteDecorations(fakeView(state)),
    syntaxIsVisible: (ranges) => rangesWithClass(ranges, "cm-active").length > 0,
  },
];

function stateAt(doc: string, pos: number) {
  return selectionState(doc, pos, pos);
}

function selectionState(doc: string, from: number, to: number) {
  return EditorState.create({
    doc,
    selection: { anchor: from, head: to },
    extensions: [obimMarkdown()],
  });
}

function move(state: EditorState, command: StateCommand) {
  let next = state;
  const handled = command({
    state,
    dispatch: (transaction) => {
      next = transaction.state;
    },
  });
  return { handled, state: next };
}

function assertVisibility(testCase: CaretCase, state: EditorState, expected: boolean) {
  const ranges = rangesForState(() => testCase.decorations(state), state);
  assert.equal(
    testCase.syntaxIsVisible(ranges),
    expected,
    `${testCase.name} visibility at position ${state.selection.main.head}`,
  );
}

function assertTargetVisibility(testCase: CaretCase, state: EditorState, expected: boolean) {
  const activeFrom = testCase.doc.indexOf(testCase.activeSource);
  const activeTo = activeFrom + testCase.activeSource.length;
  const ranges = rangesForState(() => testCase.decorations(state), state).filter(
    (range) => range.from <= activeTo && range.to >= activeFrom,
  );

  expect(testCase.syntaxIsVisible(ranges), `${testCase.name} visibility at position ${state.selection.main.head}`).toBe(
    expected,
  );
}

function walkCaretThrough(testCase: CaretCase) {
  const activeFrom = testCase.doc.indexOf(testCase.activeSource);
  const activeTo = activeFrom + testCase.activeSource.length;
  expect(activeFrom).not.toBe(-1);

  let state = stateAt(testCase.doc, 0);
  for (let pos = 0; pos <= testCase.doc.length; pos += 1) {
    expect(state.selection.main.head).toBe(pos);
    assertTargetVisibility(testCase, state, pos >= activeFrom && pos <= activeTo);
    if (pos === testCase.doc.length) break;

    const next = move(state, cursorCharForwardLogical);
    expect(next.handled).toBe(true);
    state = next.state;
  }

  for (let pos = testCase.doc.length; pos >= 0; pos -= 1) {
    expect(state.selection.main.head).toBe(pos);
    assertTargetVisibility(testCase, state, pos >= activeFrom && pos <= activeTo);
    if (pos === 0) break;

    const next = move(state, cursorCharBackwardLogical);
    expect(next.handled).toBe(true);
    state = next.state;
  }
}

test("selections reveal every syntax family only when they overlap it", () => {
  for (const testCase of cases) {
    const activeFrom = testCase.doc.indexOf(testCase.activeSource);
    const activeTo = activeFrom + testCase.activeSource.length;
    const selections = [
      { from: activeFrom, to: Math.min(activeTo, activeFrom + 1) },
      { from: Math.max(0, activeFrom - 1), to: activeFrom + 1 },
      { from: Math.max(activeFrom, activeTo - 1), to: Math.min(testCase.doc.length, activeTo + 1) },
    ];

    for (const selection of selections) {
      assertVisibility(testCase, selectionState(testCase.doc, selection.from, selection.to), true);
    }

    assertVisibility(testCase, selectionState(testCase.doc, 0, activeFrom - 1), false);
  }
});

for (const testCase of cases) {
  test(`${testCase.name} syntax follows one-character right and left caret movement`, () => {
    walkCaretThrough(testCase);
  });
}

const generatedContexts = [
  {
    name: "mixed-widget prelude",
    prefix: "Context with **strong**, `code`, [link](context.md), ![image](context.png), and $z^2$.\n\n",
    suffix: "",
  },
  {
    name: "task-list epilogue",
    prefix: "",
    suffix: "\n\n- [x] Context task with _emphasis_ and [another link](other.md).",
  },
  {
    name: "mixed surrounding blocks",
    prefix: "> Context quote with `code` and $a+b$.\n\n",
    suffix: "\n\n***\n\n![trailing image](trailing.png)",
  },
  {
    name: "long Metropolis paragraph",
    prefix:
      "The **Metropolis algorithm** was introduced as a simulation of physical systems moving toward thermal equilibrium. For a physical state `i` with energy `E_i`, a small perturbation proposes a next state `j` with energy `E_j`. If the new state is better or equal $\\frac{x}{y}$:\n\n",
    suffix: "\n\nA final paragraph contains [a note](note.md) and ![a figure](figure.png).",
  },
];

const generatedCaretCases = cases.flatMap((testCase) =>
  generatedContexts.map(({ name, prefix, suffix }) => ({
    ...testCase,
    doc: `${prefix}${testCase.doc}${suffix}`,
    name: `${testCase.name} in ${name}`,
  })),
);

test.each(generatedCaretCases)("$name preserves every caret position and its own widget state", (testCase) => {
  walkCaretThrough(testCase);
});
