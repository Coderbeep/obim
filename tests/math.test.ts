import { test } from "vitest";

import assert from "node:assert/strict";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import {
  MathBlockExtension,
  MathBlockParser,
  buildMathDecorations,
  isMathBlockLine,
  shouldRebuildMathDecorations,
} from "../src/renderer/src/features/editor/extensions/MathExpression";
import { moveDownIntoTargetLine } from "../src/renderer/src/features/editor/extensions/shared/lineNavigation";
import { marked, mutableFakeView, rangesForState, replacedTexts, textsWithClass } from "./cm-extension-test-utils";

function mathState(input: string) {
  const { text, selection } = marked(input);

  return mathStateFromText(text, selection);
}

function mathStateFromText(text: string, selection: { from: number; to: number }) {
  return EditorState.create({
    doc: text,
    selection: { anchor: selection.from, head: selection.to },
    extensions: [markdown({ base: markdownLanguage, extensions: [MathBlockParser] })],
  });
}

function mathRanges(input: string) {
  return rangesForState((view) => buildMathDecorations(view.state).decorations, mathState(input));
}

function mathHighlights(text: string) {
  const state = mathStateFromText(text, { from: 0, to: 0 });
  const highlights: Array<{ classes: string; text: string }> = [];
  highlightTree(syntaxTree(state), classHighlighter, (from, to, classes) => {
    highlights.push({ classes, text: state.sliceDoc(from, to) });
  });
  return highlights;
}

function widgetNames(input: string) {
  return mathRanges(input)
    .map((range) => range.widgetName)
    .filter((name): name is string => name !== null);
}

function mathBlockWidgetSelectedText(text: string) {
  const state = mathStateFromText(text, { from: 0, to: 0 });
  let selectedText = "";

  buildMathDecorations(state).decorations.between(0, state.doc.length, (from, _to, value) => {
    const widget = value.spec.widget as unknown as {
      constructor: { name: string };
      selectFromOffset: number;
      selectToOffset: number;
    };
    if (widget?.constructor.name !== "MathBlockWidget") return;
    selectedText = state.doc.sliceString(from + widget.selectFromOffset, from + widget.selectToOffset);
  });

  return selectedText;
}

function mathBlockWidgetEstimatedHeight(text: string) {
  const state = mathStateFromText(text, { from: 0, to: 0 });
  let estimatedHeight = 0;

  buildMathDecorations(state).decorations.between(0, state.doc.length, (_from, _to, value) => {
    const widget = value.spec.widget as unknown as {
      constructor: { name: string };
      estimatedHeight: number;
    };
    if (widget?.constructor.name === "MathBlockWidget") estimatedHeight = widget.estimatedHeight;
  });

  return estimatedHeight;
}

test("inactive inline math replaces the whole source with a widget", () => {
  const ranges = mathRanges("|\n$x + 1$");

  assert.deepEqual(replacedTexts(ranges), ["$x + 1$"]);
  assert.deepEqual(widgetNames("|\n$x + 1$"), ["MathInlineWidget"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), []);
});

test("active inline math shows both dollar delimiters", () => {
  const ranges = mathRanges("$x |+ 1$");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$", "$"]);
});

test("display math can start after ordinary text", () => {
  const inactive = mathRanges("|before $$x + 1$$ after");
  assert.deepEqual(replacedTexts(inactive), ["$$x + 1$$"]);
  assert.deepEqual(widgetNames("|before $$x + 1$$ after"), ["MathInlineWidget"]);

  const active = mathRanges("before $$x |+ 1$$ after");
  assert.deepEqual(replacedTexts(active), []);
  assert.deepEqual(textsWithClass(active, "cm-formatting-math-mark"), ["$$", "$$"]);
  assert.deepEqual(widgetNames("before $$x |+ 1$$ after"), ["MathBlockLivePreviewWidget"]);
});

test("inline-positioned display math remains rendered beside boundary carets", () => {
  for (const input of ["before |$$x + 1$$ after", "before $$x + 1$$| after"]) {
    assert.deepEqual(widgetNames(input), ["MathBlockLivePreviewWidget"]);
  }
});

test("inline, block, and quoted math expose LaTeX syntax highlighting", () => {
  for (const text of [
    "$x_{1} + \\frac{a}{b}$",
    "$$\nx_{1} + \\frac{a}{b} % note\n$$",
    "> $$\n> x_{1} + \\frac{a}{b}\n> $$",
  ]) {
    const highlights = mathHighlights(text);
    assert.match(highlights.find((highlight) => highlight.text === "\\frac")?.classes ?? "", /\btok-typeName\b/);
    assert.match(highlights.find((highlight) => highlight.text === "1")?.classes ?? "", /\btok-number\b/);
  }

  assert.match(
    mathHighlights("$$\nx + 1 % note\n$$").find((highlight) => highlight.text === "% note")?.classes ?? "",
    /\btok-comment\b/,
  );
});

test("inline math boundary carets keep delimiters visible", () => {
  for (const input of ["|$x$", "$|x$", "$x|$", "$x$|"]) {
    const ranges = mathRanges(input);

    assert.deepEqual(replacedTexts(ranges), []);
    assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$", "$"]);
  }
});

test("selection crossing inline math reveals source delimiters", () => {
  const ranges = mathRanges("before [$x]$ after");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$", "$"]);
});

test("caret in one inline math span does not reveal sibling span", () => {
  const ranges = mathRanges("$a$ and $b|$");

  assert.deepEqual(replacedTexts(ranges), ["$a$"]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$", "$"]);
});

test("inactive block math replaces the whole block with a widget", () => {
  const ranges = mathRanges("|\n$$\nx + 1\n$$");

  assert.deepEqual(replacedTexts(ranges), ["$$\nx + 1\n$$"]);
  assert.deepEqual(widgetNames("|\n$$\nx + 1\n$$"), ["MathBlockWidget"]);
});

test("inactive block math widget selects only math content when clicked", () => {
  assert.equal(mathBlockWidgetSelectedText("before\n$$\nx + 1\n$$"), "x + 1");
});

test("block math reserves height for every source line", () => {
  assert.equal(mathBlockWidgetEstimatedHeight("before\n$$\nfirst\nsecond\n$$"), 66);
});

test("active block math shows delimiters and appends live preview widget", () => {
  const ranges = mathRanges("$$\nx |+ 1\n$$");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$$", "$$"]);
  assert.deepEqual(widgetNames("$$\nx |+ 1\n$$"), ["MathBlockLivePreviewWidget"]);
});

test("block math boundary carets keep delimiters visible", () => {
  for (const input of ["|$$\nx\n$$", "$$|\nx\n$$", "$$\nx\n$$|"]) {
    const ranges = mathRanges(input);

    assert.deepEqual(replacedTexts(ranges), []);
    assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$$", "$$"]);
  }
});

test("caret on a block math opening delimiter activates the block", () => {
  const state = mathState("before\n|$$\nx\n$$\nafter");

  assert.equal(buildMathDecorations(state).activeMathNode?.name, "MathExpressionBlock");
});

test("math decorations process visible ranges plus an offscreen active node", () => {
  const first = "$first$";
  const middle = "$middle$";
  const active = "$active$";
  const text = [first, "plain\n".repeat(200), middle, "plain\n".repeat(200), active].join("\n");
  const activeFrom = text.lastIndexOf(active) + 2;
  const state = mathStateFromText(text, { from: activeFrom, to: activeFrom });
  const tree = ensureSyntaxTree(state, state.doc.length, 1_000);
  assert.ok(tree);
  const decorations = buildMathDecorations(state, tree, [{ from: 0, to: first.length }]).decorations;
  const ranges = rangesForState(() => decorations, state);

  assert.deepEqual(replacedTexts(ranges), [first]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$", "$"]);
  assert.equal(
    ranges.some(({ text }) => text.includes("middle")),
    false,
  );
});

test("math decoration range merging does not mutate caller-owned ranges", () => {
  const state = mathStateFromText("$first$ and $second$", { from: 2, to: 2 });
  const range = Object.freeze({ from: 0, to: 3 });
  const ranges = Object.freeze([range]);

  buildMathDecorations(state, syntaxTree(state), ranges);

  assert.deepEqual(range, { from: 0, to: 3 });
});

test("math decoration invalidation freezes selection-only work during pointer drags", () => {
  const unchanged = {
    docChanged: false,
    viewportChanged: false,
    pointerSelectionFinished: false,
    selectionChanged: true,
    pointerSelectionActive: true,
    syntaxTreeChanged: false,
  };

  assert.equal(shouldRebuildMathDecorations(unchanged), false);
  assert.equal(shouldRebuildMathDecorations({ ...unchanged, pointerSelectionFinished: true }), true);
  assert.equal(shouldRebuildMathDecorations({ ...unchanged, pointerSelectionActive: false }), true);
  assert.equal(shouldRebuildMathDecorations({ ...unchanged, docChanged: true }), true);
});

test("block math lines are vertical navigation targets", () => {
  const state = mathStateFromText("before\n$$\nx\n$$\nafter", { from: 0, to: 0 });

  assert.deepEqual(
    [1, 2, 3, 4, 5].map((lineNumber) => isMathBlockLine(state, lineNumber)),
    [false, true, true, true, false],
  );
});

test("MathBlock registers vertical navigation bindings", () => {
  const state = EditorState.create({
    doc: "$$\nx\n$$",
    extensions: [markdown({ base: markdownLanguage, extensions: [MathBlockParser] }), MathBlockExtension],
  });
  const keys = state
    .facet(keymap)
    .flat()
    .map((binding) => binding.key);

  assert.ok(keys.includes("ArrowUp"));
  assert.ok(keys.includes("ArrowDown"));
});

test("vertical navigation stops on skipped block math syntax", () => {
  const { view } = mutableFakeView(mathStateFromText("before\n$$\nx\n$$\nafter", { from: 0, to: 0 }));

  assert.equal(
    moveDownIntoTargetLine(view, isMathBlockLine, (skippingView) => {
      skippingView.dispatch({ selection: { anchor: skippingView.state.doc.line(5).from } });
      return true;
    }),
    true,
  );
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 2);
});

test("inactive blockquote math replaces quoted source with a block widget", () => {
  const ranges = mathRanges("|\n> $$\n> x + 1\n> $$");

  assert.deepEqual(replacedTexts(ranges), ["> $$\n> x + 1\n> $$"]);
  assert.deepEqual(widgetNames("|\n> $$\n> x + 1\n> $$"), ["MathBlockWidget"]);
});

test("active blockquote math preserves quote markers and shows math delimiters", () => {
  const ranges = mathRanges("> $$\n> x |+ 1\n> $$");

  assert.deepEqual(replacedTexts(ranges), []);
  assert.deepEqual(textsWithClass(ranges, "cm-math-blockquote-marker"), ["> ", "> ", "> "]);
  assert.deepEqual(textsWithClass(ranges, "cm-formatting-math-mark"), ["$$", "$$"]);
  assert.deepEqual(widgetNames("> $$\n> x |+ 1\n> $$"), ["MathBlockLivePreviewWidget"]);
});

test("single-line block math switches between a block widget and visible delimiters", () => {
  assert.deepEqual(replacedTexts(mathRanges("|\n$$x + 1$$")), ["$$x + 1$$"]);
  assert.deepEqual(widgetNames("|\n$$x + 1$$"), ["MathBlockWidget"]);

  const active = mathRanges("$$x |+ 1$$");
  assert.deepEqual(replacedTexts(active), []);
  assert.deepEqual(textsWithClass(active, "cm-formatting-math-mark"), ["$$", "$$"]);
  assert.deepEqual(widgetNames("$$x |+ 1$$"), ["MathBlockLivePreviewWidget"]);
});

test("empty block math remains selectable as a block widget", () => {
  assert.deepEqual(replacedTexts(mathRanges("|\n$$\n$$")), ["$$\n$$"]);
  assert.equal(mathBlockWidgetSelectedText("$$\n$$"), "");
});

test("unclosed block and inline math remain plain markdown", () => {
  for (const input of ["|$$\nx + 1", "|before $x + 1 after"]) {
    assert.deepEqual(replacedTexts(mathRanges(input)), []);
    assert.deepEqual(widgetNames(input), []);
    assert.deepEqual(textsWithClass(mathRanges(input), "cm-formatting-math-mark"), []);
  }
});

test("escaped and doubled inline dollar signs do not become inline math", () => {
  for (const input of ["|\\$literal\\$", "|before $$ after"]) {
    assert.deepEqual(widgetNames(input), []);
    assert.deepEqual(textsWithClass(mathRanges(input), "cm-formatting-math-mark"), []);
  }
});

test("active math does not reveal sibling inline or block math", () => {
  const inline = mathRanges("$a$ and $b|$ and $c$");
  assert.deepEqual(replacedTexts(inline), ["$a$", "$c$"]);
  assert.deepEqual(textsWithClass(inline, "cm-formatting-math-mark"), ["$", "$"]);

  const block = mathRanges("$$\na\n$$\n\n$$\nb|\n$$");
  assert.deepEqual(replacedTexts(block), ["$$\na\n$$"]);
  assert.deepEqual(textsWithClass(block, "cm-formatting-math-mark"), ["$$", "$$"]);
});
