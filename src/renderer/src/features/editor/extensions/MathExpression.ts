import { EditorState, StateEffect, StateField, type Range } from "@renderer/features/editor/codemirror-state";
import { ensureSyntaxTree, StreamLanguage, syntaxTree } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { DecorationSet, ViewUpdate } from "@renderer/features/editor/codemirror-view";
import { parseMixed, type Tree } from "@lezer/common";
import type { BlockContext, InlineContext, Line } from "@lezer/markdown";
import katex from "katex";
import { targetLineNavigationKeymap } from "./shared/lineNavigation";
import { rangesIntersect, type DocumentRange } from "./shared/documentRange";
import { blockquoteDepthClass, blockquoteMarkerColumns, selectSyntaxRange } from "./shared/syntaxDecorationPlugin";

// TODO: Error highlighting

const MathExpressionBlockMarker = "$$";
const MathExpressionInlineMarker = "$";
const MathInlineMarkerCode = MathExpressionInlineMarker.charCodeAt(0);
const MathExpressionBlock = "MathExpressionBlock";
const MathExpressionInlineBlock = "MathExpressionInlineBlock";
const MathExpressionInline = "MathExpressionInline";
const MathExpressionBlockMark = "MathExpressionBlockMark";
const MathExpressionInlineMark = "MathExpressionInlineMark";
const MathMarkDecoration = Decoration.mark({ class: "cm-formatting-math-mark" });
const latexParser = StreamLanguage.define(stex).parser;

const MathInlineDelim = {
  resolve: MathExpressionInline,
  mark: MathExpressionInlineMark,
};

const MathInlineBlockDelim = {
  resolve: MathExpressionInlineBlock,
  mark: MathExpressionBlockMark,
};

function isMathExpressionNode(name: string) {
  return name === MathExpressionBlock || name === MathExpressionInlineBlock || name === MathExpressionInline;
}

interface ActiveMathNode {
  from: number;
  to: number;
  name: string;
}

interface MathDecorationState {
  decorations: DecorationSet;
  activeMathNode: ActiveMathNode | null;
}

type MathDecorationRange = { from: number; to: number };

interface MathPointerSelectionState {
  active: boolean;
  selection: DocumentRange;
}

function sameMathDecorationRanges(left: readonly MathDecorationRange[], right: readonly MathDecorationRange[]) {
  return (
    left.length === right.length &&
    left.every((range, index) => range.from === right[index].from && range.to === right[index].to)
  );
}

interface BlockMathDecorationRange {
  from: number;
  to: number;
  quoteDepth: number;
}

class MathDecorationBuilder {
  private readonly ranges: Range<Decoration>[] = [];

  add(from: number, to: number, decoration: Decoration) {
    this.ranges.push(decoration.range(from, to));
  }

  finish() {
    return Decoration.set(this.ranges, true);
  }
}

function mathBlockMarkerIndex(line: Line) {
  const index = line.text.indexOf(MathExpressionBlockMarker, line.pos);
  if (index === -1) return -1;
  return /^\s*$/.test(line.text.slice(line.pos, index)) ? index : -1;
}

function blockMathContent(state: EditorState, contentFrom: number, contentTo: number, stripBlockquoteMarkers: boolean) {
  const content = state.doc.sliceString(contentFrom, contentTo);
  return stripBlockquoteMarkers ? content.replace(/^[ \t]*(?:>\s?)+/gm, "") : content;
}

function blockMathSelectionRange(state: EditorState, node: { from: number; to: number }) {
  let from = node.from + MathExpressionBlockMarker.length;
  let to = node.to - MathExpressionBlockMarker.length;

  if (state.doc.sliceString(from, from + 1) === "\n") from += 1;
  if (state.doc.sliceString(to - 1, to) === "\n") to -= 1;

  return { from, to };
}

function blockMathDecorationRange(state: EditorState, node: { from: number; to: number }): BlockMathDecorationRange {
  const startLine = state.doc.lineAt(node.from);
  const prefix = startLine.text.slice(0, node.from - startLine.from);

  if (!/^[\t >]*>[\t >]*$/.test(prefix)) {
    return { from: node.from, to: node.to, quoteDepth: 0 };
  }

  const endLine = state.doc.lineAt(Math.max(node.from, node.to - 1));
  return {
    from: startLine.from,
    to: endLine.to,
    quoteDepth: Math.min(prefix.match(/>/g)!.length, 4),
  };
}

function addMathDelimiterDecorations(builder: MathDecorationBuilder, from: number, to: number, markerLength: number) {
  builder.add(from, from + markerLength, MathMarkDecoration);
  builder.add(to - markerLength, to, MathMarkDecoration);
}

function addActiveBlockquoteMathDecorations(
  builder: MathDecorationBuilder,
  state: EditorState,
  range: BlockMathDecorationRange,
  node: { from: number; to: number },
) {
  if (!range.quoteDepth) return;

  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(Math.max(range.from, range.to - 1));
  const openingMarkTo = node.from + MathExpressionBlockMarker.length;
  const closingMarkFrom = node.to - MathExpressionBlockMarker.length;

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const markerColumns = blockquoteMarkerColumns(line.text);
    if (!markerColumns) continue;

    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: `cm-blockquote-line cm-blockquote-depth-${range.quoteDepth}`,
        attributes: {
          style: `padding-left: calc(0.9rem + ${Math.max(markerColumns - 1, 0)}ch); text-indent: -${markerColumns}ch`,
        },
      }),
    );
    builder.add(
      line.from,
      Math.min(line.from + markerColumns, line.to),
      Decoration.mark({ class: "cm-math-blockquote-marker" }),
    );

    if (node.from >= line.from && node.from < line.to) {
      builder.add(node.from, openingMarkTo, MathMarkDecoration);
    }

    if (closingMarkFrom >= line.from && closingMarkFrom < line.to) {
      builder.add(closingMarkFrom, node.to, MathMarkDecoration);
    }
  }
}

const findMathBlockEnd = (cx: BlockContext, line: Line, markerIndex: number) => {
  // Check if the block ends on the same line
  const markLength = MathExpressionBlockMarker.length;
  const sameLineIndex = line.text.indexOf(MathExpressionBlockMarker, markerIndex + markLength);

  if (sameLineIndex !== -1) {
    return cx.lineStart + sameLineIndex + markLength;
  }

  // Search the next lines
  let hasNextLine: boolean;
  let index: number;
  do {
    hasNextLine = cx.nextLine();
    index = mathBlockMarkerIndex(line);
  } while (hasNextLine && index === -1);

  if (!hasNextLine) {
    return -1;
  }

  return cx.lineStart + index + markLength;
};

export const MathBlockParser = {
  defineNodes: [
    { name: MathExpressionBlock, block: true },
    { name: MathExpressionInlineBlock, block: false },
    { name: MathExpressionInline, block: false },
    MathExpressionBlockMark,
    MathExpressionInlineMark,
  ],
  wrap: parseMixed((node) =>
    isMathExpressionNode(node.name)
      ? {
          parser: latexParser,
          overlay: [{ from: node.from, to: node.to }],
          bracketed: true,
        }
      : null,
  ),
  parseBlock: [
    {
      name: MathExpressionBlock,
      parse(cx: BlockContext, line: Line) {
        const markerIndex = mathBlockMarkerIndex(line);
        if (markerIndex === -1) {
          return false;
        }

        const from = cx.lineStart + markerIndex;
        const markLength = MathExpressionBlockMarker.length;
        const to = findMathBlockEnd(cx, line, markerIndex);
        if (to === -1) {
          return false;
        }

        cx.addElement(cx.elt(MathExpressionBlockMark, from, from + markLength));
        cx.addElement(cx.elt(MathExpressionBlock, from, to));
        cx.addElement(cx.elt(MathExpressionBlockMark, to - markLength, to));
        cx.nextLine();

        return true;
      },
      endLeaf(cx: BlockContext, line: Line) {
        void cx;
        return mathBlockMarkerIndex(line) !== -1;
      },
    },
  ],
  parseInline: [
    {
      name: MathExpressionInline,
      parse(cx: InlineContext, next: number, start: number) {
        if (next !== MathInlineMarkerCode) {
          return -1;
        }

        const pos = start - cx.offset;
        const previousChar = pos > 0 ? cx.text.charCodeAt(pos - 1) : -1;
        const nextChar = pos + 1 < cx.text.length ? cx.text.charCodeAt(pos + 1) : -1;

        if (nextChar === MathInlineMarkerCode && previousChar !== MathInlineMarkerCode) {
          return cx.addDelimiter(MathInlineBlockDelim, start, start + MathExpressionBlockMarker.length, true, true);
        }

        if (previousChar === MathInlineMarkerCode) {
          return -1;
        }

        return cx.addDelimiter(MathInlineDelim, start, start + 1, true, true);
      },
    },
  ],
};

const katexDomKeyCache = new WeakMap<HTMLElement, string>();

function getKatexCacheKey(mathContent: string, displayMode: boolean): string {
  return `${displayMode ? "block" : "inline"}:${mathContent}`;
}

function syncKatexDom(dom: HTMLElement, mathContent: string, displayMode: boolean): void {
  const key = getKatexCacheKey(mathContent, displayMode);
  if (katexDomKeyCache.get(dom) === key) return;

  katex.render(mathContent, dom, {
    throwOnError: false,
    displayMode,
  });
  katexDomKeyCache.set(dom, key);
}

function estimateBlockMathHeight(mathContent: string): number {
  const normalizedContent = mathContent.trim();
  let lineCount = 1;
  for (let index = 0; index < normalizedContent.length; index += 1) {
    if (normalizedContent.charCodeAt(index) === 10) lineCount += 1;
  }
  return Math.max(56, lineCount * 24 + 18);
}

function syncMathSelection(dom: HTMLElement, selectFromOffset: number, selectToOffset: number) {
  dom.dataset.mathSelectFromOffset = String(selectFromOffset);
  dom.dataset.mathSelectToOffset = String(selectToOffset);
}

function dispatchMathSelection(view: EditorView, target: HTMLElement): void {
  const widgetFrom = view.posAtDOM(target);
  const anchor = widgetFrom + Number.parseInt(target.dataset.mathSelectFromOffset ?? "", 10);
  const head = widgetFrom + Number.parseInt(target.dataset.mathSelectToOffset ?? "", 10);

  if (Number.isNaN(anchor) || Number.isNaN(head)) return;
  selectSyntaxRange(view, anchor, head);
}

function findActiveMathNode(state: EditorState, tree: Tree = syntaxTree(state)): ActiveMathNode | null {
  const selection = state.selection.main;
  const resolvePositions = [Math.min(selection.from, state.doc.length)];

  if (selection.from === selection.to && selection.from > 0) {
    resolvePositions.push(selection.from - 1);
  }
  for (const resolvePos of resolvePositions) {
    let currentNode = tree.resolve(resolvePos, 1);
    let reachedRoot = false;
    while (currentNode && !isMathExpressionNode(currentNode.name)) {
      const parent = currentNode.parent;
      if (!parent) {
        reachedRoot = true;
        break;
      }
      currentNode = parent;
    }

    if (reachedRoot) continue;

    const isInsideMath = rangesIntersect(selection, currentNode);

    if (!isInsideMath) continue;

    return {
      from: currentNode.from,
      to: currentNode.to,
      name: currentNode.name,
    };
  }

  let activeMathNode: ActiveMathNode | null = null;
  tree.iterate({
    from: Math.max(0, selection.from - 1),
    to: Math.min(state.doc.length, selection.to + 1),
    enter: (node) => {
      if (activeMathNode) return false;
      if (!isMathExpressionNode(node.name)) return;

      const isInsideMath = rangesIntersect(selection, node);
      if (!isInsideMath) return;

      activeMathNode = { from: node.from, to: node.to, name: node.name };
      return false;
    },
  });

  return activeMathNode;
}

export function isMathBlockLine(state: EditorState, lineNumber: number) {
  const line = state.doc.line(lineNumber);
  const tree = ensureSyntaxTree(state, line.to);
  if (!tree) return false;

  let isMathBlock = false;

  tree.iterate({
    from: line.from,
    to: Math.max(line.from + 1, line.to),
    enter: (node) => {
      if (node.name !== MathExpressionBlock) return;
      isMathBlock = true;
      return false;
    },
  });

  return isMathBlock;
}

const mergedMathDecorationRanges = (
  ranges: readonly MathDecorationRange[],
  activeMathNode: ActiveMathNode | null,
): MathDecorationRange[] => {
  const ordered = [...ranges, ...(activeMathNode ? [activeMathNode] : [])].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  const merged: MathDecorationRange[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ from: range.from, to: range.to });
  }
  return merged;
};

export function buildMathDecorations(
  state: EditorState,
  tree: Tree = syntaxTree(state),
  ranges: readonly MathDecorationRange[] = [{ from: 0, to: state.doc.length }],
): MathDecorationState {
  const builder = new MathDecorationBuilder();
  const activeMathNode = findActiveMathNode(state, tree);
  const pointerSelection = state.field(mathPointerSelectionField, false);
  const mathSelection = pointerSelection?.active ? pointerSelection.selection : state.selection.main;

  for (const range of mergedMathDecorationRanges(ranges, activeMathNode))
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (node.name === MathExpressionBlock) {
          const isActive = rangesIntersect(mathSelection, node);
          const markLength = MathExpressionBlockMarker.length;
          const decorationRange = blockMathDecorationRange(state, node);
          const selectionRange = blockMathSelectionRange(state, node);
          const mathContent = blockMathContent(
            state,
            node.from + markLength,
            node.to - markLength,
            decorationRange.quoteDepth > 0,
          );

          if (isActive) {
            if (decorationRange.quoteDepth) {
              addActiveBlockquoteMathDecorations(builder, state, decorationRange, node);
            } else {
              addMathDelimiterDecorations(builder, node.from, node.to, markLength);
            }
            builder.add(
              decorationRange.to,
              decorationRange.to,
              Decoration.widget({
                widget: new MathBlockLivePreviewWidget(mathContent, decorationRange.quoteDepth),
                block: true,
                side: 1,
              }),
            );
            return false;
          }

          builder.add(
            decorationRange.from,
            decorationRange.to,
            Decoration.replace({
              widget: new MathBlockWidget(
                mathContent,
                selectionRange.from - decorationRange.from,
                selectionRange.to - decorationRange.from,
                decorationRange.quoteDepth,
              ),
              block: true,
            }),
          );
          return false;
        }

        if (node.name !== MathExpressionInline && node.name !== MathExpressionInlineBlock) return;

        const isActive = rangesIntersect(mathSelection, node);
        const isInlineBlock = node.name === MathExpressionInlineBlock;
        const markLength = isInlineBlock ? MathExpressionBlockMarker.length : MathExpressionInlineMarker.length;
        const mathContent = state.doc.sliceString(node.from + markLength, node.to - markLength);
        if (isActive) {
          addMathDelimiterDecorations(builder, node.from, node.to, markLength);
          if (isInlineBlock) {
            builder.add(
              node.to,
              node.to,
              Decoration.widget({
                widget: new MathBlockLivePreviewWidget(mathContent, 0),
                side: 1,
              }),
            );
          }
          return false;
        }

        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new MathInlineWidget(mathContent, markLength, node.to - node.from - markLength, isInlineBlock),
          }),
        );
        return false;
      },
    });

  return {
    decorations: builder.finish(),
    activeMathNode,
  };
}

const setMathVisibleRanges = StateEffect.define<readonly MathDecorationRange[]>();
const setMathPointerSelecting = StateEffect.define<boolean>();
const initialMathDecorationRange = (state: EditorState): MathDecorationRange => ({
  from: Math.max(0, state.selection.main.from - 5_000),
  to: Math.min(state.doc.length, state.selection.main.to + 5_000),
});
const mathVisibleRangesField = StateField.define<readonly MathDecorationRange[]>({
  create: (state) => [initialMathDecorationRange(state)],
  update(ranges, transaction) {
    if (transaction.docChanged)
      ranges = ranges.map(({ from, to }) => ({
        from: transaction.changes.mapPos(from, -1),
        to: transaction.changes.mapPos(to, 1),
      }));
    for (const effect of transaction.effects) if (effect.is(setMathVisibleRanges)) ranges = effect.value;
    return ranges;
  },
});

const mathPointerSelectionField = StateField.define<MathPointerSelectionState>({
  create: (state) => ({
    active: false,
    selection: { from: state.selection.main.from, to: state.selection.main.to },
  }),
  update(value, transaction) {
    if (transaction.docChanged && value.active) {
      value = {
        active: false,
        selection: {
          from: transaction.state.selection.main.from,
          to: transaction.state.selection.main.to,
        },
      };
    }

    for (const effect of transaction.effects) {
      if (!effect.is(setMathPointerSelecting)) continue;
      value = {
        active: effect.value,
        selection: {
          from: transaction.state.selection.main.from,
          to: transaction.state.selection.main.to,
        },
      };
    }
    return value;
  },
});

const mathPointerSelectionPlugin = ViewPlugin.fromClass(
  class {
    private finishFrame: number | null = null;
    private frozen = false;
    private selecting = false;
    private readonly document: Document;

    constructor(private readonly view: EditorView) {
      this.document = view.contentDOM.ownerDocument;
      view.dom.addEventListener("mousedown", this.handleMouseDown, true);
      this.document.addEventListener("mousemove", this.handleMouseMove, true);
      this.document.addEventListener("mouseup", this.handleMouseUp, true);
    }

    destroy() {
      this.view.dom.removeEventListener("mousedown", this.handleMouseDown, true);
      this.document.removeEventListener("mousemove", this.handleMouseMove, true);
      this.document.removeEventListener("mouseup", this.handleMouseUp, true);
      if (this.finishFrame !== null) cancelAnimationFrame(this.finishFrame);
    }

    private readonly handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (this.finishFrame !== null) {
        cancelAnimationFrame(this.finishFrame);
        this.finishFrame = null;
        this.view.dispatch({ effects: setMathPointerSelecting.of(false) });
      }

      if (event.target instanceof Element && event.target.closest(".cm-math-widget")) {
        this.selecting = false;
        this.frozen = false;
        return;
      }

      this.selecting = true;
      this.frozen = true;
      this.view.dispatch({ effects: setMathPointerSelecting.of(true) });
    };

    private readonly handleMouseMove = (event: MouseEvent) => {
      if (!this.selecting) return;
      if ((event.buttons & 1) === 0) {
        this.finishSelection();
      } else if (!this.frozen) {
        this.frozen = true;
        this.view.dispatch({ effects: setMathPointerSelecting.of(true) });
      }
    };

    private readonly handleMouseUp = (event: MouseEvent) => {
      if (event.button === 0) this.finishSelection();
    };

    private finishSelection() {
      if (!this.selecting) return;
      this.selecting = false;
      if (!this.frozen) return;
      this.frozen = false;
      this.finishFrame = requestAnimationFrame(() => {
        this.finishFrame = null;
        this.view.dispatch({ effects: setMathPointerSelecting.of(false) });
      });
    }
  },
);

const mathViewportPlugin = ViewPlugin.fromClass(
  class {
    private frame: number | null = null;
    private pending: readonly MathDecorationRange[] = [];

    constructor(private readonly view: EditorView) {
      this.queue(view.visibleRanges);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.queue(update.view.visibleRanges);
    }

    destroy() {
      if (this.frame !== null) cancelAnimationFrame(this.frame);
    }

    private queue(ranges: readonly MathDecorationRange[]) {
      this.pending = ranges.map(({ from, to }) => ({ from, to }));
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        const next = this.pending;
        this.pending = [];
        if (sameMathDecorationRanges(next, this.view.state.field(mathVisibleRangesField))) return;
        this.view.dispatch({ effects: setMathVisibleRanges.of(next) });
      });
    }
  },
);

const mathDecorationsField = StateField.define<MathDecorationState>({
  create(state) {
    return buildMathDecorations(state, syntaxTree(state), [initialMathDecorationRange(state)]);
  },
  update(value, transaction) {
    const viewportChanged = transaction.effects.some((effect) => effect.is(setMathVisibleRanges));
    const pointerSelectionFinished = transaction.effects.some(
      (effect) => effect.is(setMathPointerSelecting) && !effect.value,
    );
    const selectionChanged = !transaction.startState.selection.eq(transaction.state.selection);
    const pointerSelectionActive = transaction.state.field(mathPointerSelectionField).active;
    const syntaxTreeChanged = syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    if (
      !shouldRebuildMathDecorations({
        docChanged: transaction.docChanged,
        viewportChanged,
        pointerSelectionFinished,
        selectionChanged,
        pointerSelectionActive,
        syntaxTreeChanged,
      })
    )
      return value;
    return buildMathDecorations(
      transaction.state,
      syntaxTree(transaction.state),
      transaction.state.field(mathVisibleRangesField),
    );
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function shouldRebuildMathDecorations(update: {
  docChanged: boolean;
  viewportChanged: boolean;
  pointerSelectionFinished: boolean;
  selectionChanged: boolean;
  pointerSelectionActive: boolean;
  syntaxTreeChanged: boolean;
}) {
  return (
    update.docChanged ||
    update.viewportChanged ||
    update.pointerSelectionFinished ||
    (update.selectionChanged && !update.pointerSelectionActive) ||
    update.syntaxTreeChanged
  );
}

class MathBlockWidget extends WidgetType {
  constructor(
    private readonly mathContent: string,
    private readonly selectFromOffset: number,
    private readonly selectToOffset: number,
    private readonly quoteDepth: number,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement("div");
    this.syncDOM(container);
    container.addEventListener("mousedown", (event) => {
      event.preventDefault();
      dispatchMathSelection(view, event.currentTarget as HTMLElement);
    });
    return container;
  }

  updateDOM(dom: HTMLElement) {
    this.syncDOM(dom);
    return true;
  }

  get estimatedHeight() {
    return estimateBlockMathHeight(this.mathContent);
  }

  private syncDOM(dom: HTMLElement) {
    dom.className = mathBlockWidgetClassName(this.quoteDepth);
    syncKatexDom(dom, this.mathContent, true);
    syncMathSelection(dom, this.selectFromOffset, this.selectToOffset);
  }

  eq(other: MathBlockWidget) {
    return (
      this.mathContent === other.mathContent &&
      this.selectFromOffset === other.selectFromOffset &&
      this.selectToOffset === other.selectToOffset &&
      this.quoteDepth === other.quoteDepth
    );
  }
}

class MathInlineWidget extends WidgetType {
  constructor(
    private readonly mathContent: string,
    private readonly selectFromOffset: number,
    private readonly selectToOffset: number,
    private readonly displayMode = false,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const container = document.createElement("span");
    this.syncDOM(container);
    container.addEventListener("mousedown", (event) => {
      event.preventDefault();
      dispatchMathSelection(view, event.currentTarget as HTMLElement);
    });
    return container;
  }

  updateDOM(dom: HTMLElement) {
    this.syncDOM(dom);
    return true;
  }

  private syncDOM(dom: HTMLElement) {
    dom.className = mathInlineWidgetClassName(this.displayMode);
    syncKatexDom(dom, this.mathContent, this.displayMode);
    syncMathSelection(dom, this.selectFromOffset, this.selectToOffset);
  }

  eq(other: MathInlineWidget) {
    return (
      this.mathContent === other.mathContent &&
      this.selectFromOffset === other.selectFromOffset &&
      this.selectToOffset === other.selectToOffset &&
      this.displayMode === other.displayMode
    );
  }
}

class MathBlockLivePreviewWidget extends WidgetType {
  constructor(
    private readonly mathContent: string,
    private readonly quoteDepth: number,
  ) {
    super();
  }

  toDOM() {
    const container = document.createElement("div");
    this.syncDOM(container);
    return container;
  }

  updateDOM(dom: HTMLElement) {
    this.syncDOM(dom);
    return true;
  }

  get estimatedHeight() {
    return estimateBlockMathHeight(this.mathContent);
  }

  private syncDOM(dom: HTMLElement) {
    dom.className = `${mathBlockWidgetClassName(this.quoteDepth)} cm-math-widget-live-preview`;
    syncKatexDom(dom, this.mathContent, true);
  }

  eq(other: MathBlockLivePreviewWidget) {
    return this.mathContent === other.mathContent && this.quoteDepth === other.quoteDepth;
  }
}

function mathBlockWidgetClassName(quoteDepth: number) {
  if (!quoteDepth) return "cm-math-widget cm-math-widget-block";
  return `cm-math-widget cm-math-widget-block cm-math-widget-blockquote cm-blockquote-line ${blockquoteDepthClass(
    quoteDepth,
  )}`;
}

function mathInlineWidgetClassName(displayMode: boolean) {
  return `cm-math-widget cm-math-widget-inline${displayMode ? " cm-math-widget-display-inline" : ""}`;
}

export const MathBlockExtension = [
  mathVisibleRangesField,
  mathPointerSelectionField,
  mathDecorationsField,
  mathViewportPlugin,
  mathPointerSelectionPlugin,
  targetLineNavigationKeymap(isMathBlockLine),
];
