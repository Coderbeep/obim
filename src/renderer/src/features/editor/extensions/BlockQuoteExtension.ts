import { Decoration, EditorView, WidgetType } from "@renderer/features/editor/codemirror-view";
import type { Range } from "@renderer/features/editor/codemirror-state";
import {
  blockquoteDepthClass,
  blockquoteMarkerColumns,
  createSyntaxDecorationPlugin,
  decorationSet,
  isSyntaxRangeActive,
  iterateVisibleSyntaxTree,
  selectSyntaxRange,
} from "./shared/syntaxDecorationPlugin";

const noteCalloutPattern = /^(\s*(?:>\s*)+)(\[!(info|note|tip|warning|danger|important)\])/iu;

type NoteCalloutKind = "info" | "note" | "tip" | "warning" | "danger" | "important";

interface NoteCalloutRange {
  from: number;
  to: number;
  kind: NoteCalloutKind;
  markerFrom: number;
  markerTo: number;
}

class CalloutLabelWidget extends WidgetType {
  constructor(
    private readonly kind: NoteCalloutKind,
    private readonly markerFrom: number,
    private readonly markerTo: number,
  ) {
    super();
  }

  toDOM(view: EditorView) {
    const label = document.createElement("span");
    label.className = `cm-callout-label cm-callout-label-${this.kind}`;
    label.textContent = this.kind.toLocaleUpperCase();
    label.onclick = (event) => {
      event.preventDefault();
      selectSyntaxRange(view, this.markerFrom, this.markerTo);
    };
    if (!view.state.facet(EditorView.editable)) label.classList.add("cm-widget-readonly");
    return label;
  }

  eq(other: CalloutLabelWidget) {
    return other.kind === this.kind && other.markerFrom === this.markerFrom && other.markerTo === this.markerTo;
  }
}

function noteCalloutAtLine(view: EditorView, lineFrom: number): Omit<NoteCalloutRange, "from" | "to"> | null {
  const line = view.state.doc.lineAt(lineFrom);
  const match = noteCalloutPattern.exec(line.text);
  if (!match) return null;

  const markerFrom = line.from + match[1].length;
  return {
    kind: match[3].toLocaleLowerCase() as NoteCalloutKind,
    markerFrom,
    markerTo: markerFrom + match[2].length,
  };
}

const blockquoteDecorations = {
  Blockquote: (isActive: boolean) =>
    Decoration.mark({ class: isActive ? "cm-formatting-blockquote cm-active" : "cm-formatting-blockquote" }),
  BlockquoteLine: (depth: number, markerColumns: number, extraClass = "") =>
    Decoration.line({
      class: `cm-blockquote-line ${blockquoteDepthClass(depth)}${extraClass}`,
      attributes: {
        style: `padding-left: calc(0.9rem + ${Math.min(depth - 1, 3) * 0.42}rem); text-indent: -${markerColumns}ch`,
      },
    }),
  QuoteMark: Decoration.mark({ class: "cm-formatting-quote-mark" }),
};

export function buildBlockQuoteDecorations(view: EditorView) {
  const decorations: Range<Decoration>[] = [];
  const quoteDepthByLine = new Map<number, number>();
  const calloutsByMarker = new Map<number, NoteCalloutRange>();

  iterateVisibleSyntaxTree(view, (node) => {
    if (node.name === "Blockquote") {
      const callout = noteCalloutAtLine(view, node.from);
      if (callout) {
        const existing = calloutsByMarker.get(callout.markerFrom);
        if (!existing || node.to - node.from < existing.to - existing.from) {
          calloutsByMarker.set(callout.markerFrom, { ...callout, from: node.from, to: node.to });
        }
      }
      decorations.push(
        blockquoteDecorations.Blockquote(isSyntaxRangeActive(view.state, node.from, node.to)).range(node.from, node.to),
      );
      return;
    }

    if (node.name === "QuoteMark") {
      const lineFrom = view.state.doc.lineAt(node.from).from;
      quoteDepthByLine.set(lineFrom, (quoteDepthByLine.get(lineFrom) ?? 0) + 1);
      decorations.push(blockquoteDecorations.QuoteMark.range(node.from, node.to));
    }
  });

  const callouts = [...calloutsByMarker.values()];
  for (const callout of callouts) {
    const markerLine = view.state.doc.lineAt(callout.markerFrom);
    if (isSyntaxRangeActive(view.state, markerLine.from, markerLine.to)) {
      decorations.push(
        Decoration.mark({ class: `cm-formatting-callout cm-callout-${callout.kind} cm-active` }).range(
          callout.markerFrom,
          callout.markerTo,
        ),
      );
    } else {
      decorations.push(
        Decoration.replace({
          widget: new CalloutLabelWidget(callout.kind, callout.markerFrom, callout.markerTo),
        }).range(callout.markerFrom, callout.markerTo),
      );
    }
  }

  for (const [lineFrom, depth] of quoteDepthByLine) {
    const line = view.state.doc.lineAt(lineFrom);
    const callout = callouts
      .filter((candidate) => candidate.from <= lineFrom && lineFrom <= candidate.to)
      .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
    const calloutLineFroms = callout
      ? [...quoteDepthByLine.keys()].filter((candidate) => callout.from <= candidate && candidate <= callout.to)
      : [];
    const positionClass = callout
      ? `${lineFrom === calloutLineFroms[0] ? " cm-callout-first" : ""}${
          lineFrom === calloutLineFroms.at(-1) ? " cm-callout-last" : ""
        }`
      : "";
    const calloutClass = callout ? ` cm-callout-line cm-callout-${callout.kind}${positionClass}` : "";
    decorations.push(
      blockquoteDecorations.BlockquoteLine(depth, blockquoteMarkerColumns(line.text), calloutClass).range(lineFrom),
    );
  }

  return decorationSet(decorations);
}

export const BlockQuoteExtension = createSyntaxDecorationPlugin(buildBlockQuoteDecorations);
