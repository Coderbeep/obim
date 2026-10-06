import { foldable, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import { Decoration, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { Range } from "@renderer/features/editor/codemirror-state";
import type { EditorState } from "@renderer/features/editor/codemirror-state";
import type { EditorView } from "@renderer/features/editor/codemirror-view";
import type { SyntaxNodeRef } from "@lezer/common";
import {
  createSyntaxDecorationPlugin,
  decorationSet,
  directChildren,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  pushDecorationRange,
} from "./shared/syntaxDecorationPlugin";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeaderMark = { from: number; to: number };

const tokenFormattingClasses = {
  HeadingMarkHidden: Decoration.replace({}),
  SetextMarkHidden: Decoration.replace({}),
  PendingBulletParagraph: Decoration.mark({ class: "cm-pending-bullet-paragraph" }),
  HeadingMark: Decoration.mark({ class: "cm-formatting-heading-mark" }),
  headings: {
    1: Decoration.mark({ class: "cm-formatting-heading-1" }),
    2: Decoration.mark({ class: "cm-formatting-heading-2" }),
    3: Decoration.mark({ class: "cm-formatting-heading-3" }),
    4: Decoration.mark({ class: "cm-formatting-heading-4" }),
    5: Decoration.mark({ class: "cm-formatting-heading-5" }),
    6: Decoration.mark({ class: "cm-formatting-heading-6" }),
  } satisfies Record<HeadingLevel, Decoration>,
};

const atxHeadingLevels: Record<string, HeadingLevel> = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

const setextHeadingLevels: Record<string, 1 | 2> = {
  SetextHeading1: 1,
  SetextHeading2: 2,
};

type FoldRange = { from: number; to: number };

function isFolded(state: EditorState, range: FoldRange) {
  let folded = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) folded = true;
  });
  return folded;
}

class HeadingFoldWidget extends WidgetType {
  constructor(
    readonly range: FoldRange,
    readonly folded: boolean,
    readonly level: HeadingLevel,
  ) {
    super();
  }

  eq(other: HeadingFoldWidget) {
    return (
      this.range.from === other.range.from &&
      this.range.to === other.range.to &&
      this.folded === other.folded &&
      this.level === other.level
    );
  }

  toDOM(view: EditorView) {
    const button = document.createElement("button");
    const label = document.createElement("span");
    const indicator = document.createElement("span");
    const action = this.folded ? "Expand" : "Collapse";

    button.type = "button";
    button.className = "cm-heading-fold-toggle";
    button.dataset.level = String(this.level);
    button.dataset.folded = String(this.folded);
    button.setAttribute("aria-label", `${action} section`);
    button.setAttribute("aria-expanded", String(!this.folded));
    button.title = `${action} section`;
    label.className = "cm-heading-fold-label";
    label.textContent = `H${this.level}`;
    indicator.className = "cm-heading-level-indicator";
    indicator.setAttribute("aria-hidden", "true");
    button.append(label, indicator);

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const folded = isFolded(view.state, this.range);
      view.dispatch({ effects: (folded ? unfoldEffect : foldEffect).of(this.range) });
      view.focus();
    });

    return button;
  }

  ignoreEvent() {
    return true;
  }
}

function isInlineSpace(char: string) {
  return char === " " || char === "\t";
}

function getHeaderMarks(node: SyntaxNodeRef): HeaderMark[] {
  return directChildren(node, "HeaderMark").map(({ from, to }) => ({ from, to }));
}

function pushSyntaxVisibility(
  decorations: Range<Decoration>[],
  from: number,
  to: number,
  isActive: boolean,
  hiddenDecoration = tokenFormattingClasses.HeadingMarkHidden,
) {
  pushDecorationRange(decorations, isActive ? tokenFormattingClasses.HeadingMark : hiddenDecoration, from, to);
}

function hideOpeningMark(view: EditorView, node: SyntaxNodeRef, level: HeadingLevel) {
  const text = view.state.doc.sliceString(node.from, node.to);
  let end = level;

  while (end < text.length && isInlineSpace(text[end])) end++;

  return { from: node.from, to: node.from + end };
}

function hideClosingMark(view: EditorView, node: SyntaxNodeRef, mark: HeaderMark) {
  const text = view.state.doc.sliceString(node.from, node.to);
  let from = mark.from - node.from;
  let to = mark.to - node.from;

  while (from > 0 && isInlineSpace(text[from - 1])) from--;
  while (to < text.length && isInlineSpace(text[to])) to++;

  return { from: node.from + from, to: node.from + to };
}

function addAtxHeadingDecorations(
  view: EditorView,
  node: SyntaxNodeRef,
  level: HeadingLevel,
  decorations: Range<Decoration>[],
) {
  const isActive = isSyntaxRangeActive(view.state, node.from, node.to);
  const marks = getHeaderMarks(node);

  pushDecorationRange(decorations, tokenFormattingClasses.headings[level], node.from, node.to);

  const openingRange = hideOpeningMark(view, node, level);
  pushSyntaxVisibility(decorations, openingRange.from, openingRange.to, isActive);

  const closingMark = marks.length > 1 ? marks[marks.length - 1] : null;
  if (closingMark) {
    const range = hideClosingMark(view, node, closingMark);
    pushSyntaxVisibility(decorations, range.from, range.to, isActive);
  }
}

function addSetextHeadingDecorations(
  view: EditorView,
  node: SyntaxNodeRef,
  level: 1 | 2,
  decorations: Range<Decoration>[],
) {
  const isActive = isSyntaxRangeActive(view.state, node.from, node.to);
  const underlineMark = getHeaderMarks(node)[0];
  const underlineLine = underlineMark ? view.state.doc.lineAt(underlineMark.from) : null;
  const headingTo = underlineLine ? Math.max(node.from, underlineLine.from - 1) : node.to;

  if (level === 2 && underlineLine?.text.trim() === "-") {
    pushDecorationRange(decorations, tokenFormattingClasses.PendingBulletParagraph, node.from, headingTo);
    return false;
  }

  pushDecorationRange(decorations, tokenFormattingClasses.headings[level], node.from, headingTo);

  if (!underlineMark || !underlineLine) return true;

  pushSyntaxVisibility(
    decorations,
    underlineMark.from,
    underlineMark.to,
    isActive,
    tokenFormattingClasses.SetextMarkHidden,
  );
  return true;
}

function addHeadingFoldToggle(
  view: EditorView,
  node: SyntaxNodeRef,
  level: HeadingLevel,
  decorations: Range<Decoration>[],
) {
  const line = view.state.doc.lineAt(node.from);
  const range = foldable(view.state, line.from, line.to);
  if (!range) return;

  decorations.push(
    Decoration.widget({
      widget: new HeadingFoldWidget(range, isFolded(view.state, range), level),
      side: -1,
    }).range(node.from),
  );
}

export function buildHeadingDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];

  iterateVisibleSyntaxTree(view, (node) => {
    const atxLevel = atxHeadingLevels[node.name];
    if (atxLevel) {
      addHeadingFoldToggle(view, node, atxLevel, decorations);
      addAtxHeadingDecorations(view, node, atxLevel, decorations);
      return false;
    }

    const setextLevel = setextHeadingLevels[node.name];
    if (setextLevel) {
      if (addSetextHeadingDecorations(view, node, setextLevel, decorations)) {
        addHeadingFoldToggle(view, node, setextLevel, decorations);
      }
      return false;
    }

    return undefined;
  });

  return decorationSet(decorations);
}

export const HeadingExtension = createSyntaxDecorationPlugin(buildHeadingDecorations, {
  shouldRebuild: (update) => foldedRanges(update.startState) !== foldedRanges(update.state),
});
