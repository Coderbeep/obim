import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import katex from "katex";

// TODO: Error highlighting

const MathExpressionBlockMarker = "$$";
const MathExpressionInlineMarker = "$";
const MathExpressionBlock = "MathExpressionBlock";
const MathExpressionInline = "MathExpressionInline";
const MathExpressionBlockMark = "MathExpressionBlockMark";
const MathExpressionInlineMark = "MathExpressionInlineMark";

const MathInlineDelim = {
  resolve: MathExpressionInline,
  mark: MathExpressionInlineMark,
};

const findMathBlockEnd = (cx, line) => {
  // Check if the block ends on the same line
  const markLength = 2;
  const sameLineIndex = line.text.indexOf("$$", markLength);

  if (sameLineIndex !== -1) {
    return cx.lineStart + line.pos + sameLineIndex + markLength;
  }

  // Search the next lines
  let hasNextLine /* : boolean */;
  let index /* : number */;
  do {
    hasNextLine = cx.nextLine();
    index = line.text.indexOf("$$");
  } while (hasNextLine && index === -1);

  if (!hasNextLine) {
    return -1;
  }

  return cx.lineStart + line.pos + index + markLength;
};

export const MathBlockParser = {
  defineNodes: [
    { name: MathExpressionBlock, block: true },
    { name: MathExpressionInline, block: false },
    MathExpressionBlockMark,
    MathExpressionInlineMark,
  ],
  parseBlock: [
    {
      name: MathExpressionBlock,
      parse(cx, line) {
        if (!line.text.startsWith("$$")) {
          return false;
        }

        const from = cx.lineStart + line.pos;

        const markLength = 2;
        cx.addElement(cx.elt(MathExpressionBlockMark, from, from + markLength));

        const to = findMathBlockEnd(cx, line);
        if (to === -1) {
          return false;
        }
        cx.addElement(cx.elt(MathExpressionBlock, from, to));
        cx.addElement(cx.elt(MathExpressionBlockMark, to - markLength, to));
        cx.nextLine();

        return true;
      },
      endLeaf(_, line) {
        return line.text.startsWith("$$");
      },
    },
  ],
  parseInline: [
    {
      name: MathExpressionInline,
      parse(cx, next, start) {
        if (next != 36) {
          return -1;
        }
        return cx.addDelimiter(MathInlineDelim, start, start + 1, true, true);
      },
    },
  ],
};
const toggleMathBLockVisibilityEffect = StateEffect.define();

const mathBlockVisibilityField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return Decoration.none;
    }

    for (let effect of transaction.effects) {
      if (effect.is(toggleMathBLockVisibilityEffect)) {
        decorations = effect.value;
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function createFrontmatterDecorations(view) {
  const builder = new RangeSetBuilder();
  const { from, to } = view.state.selection.main;

  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (node.name === MathExpressionBlock) {
        const mathContent = view.state.sliceDoc(node.from + 2, node.to - 2);
        const isActive = from >= node.from && to <= node.to;
        if (!isActive) {
          builder.add(
            node.from,
            node.to,
            Decoration.replace({
              widget: new MathBlockWidget(mathContent),
            }),
          );
        }
      }

      if (node.name === MathExpressionInline) {
        const mathContent = view.state.sliceDoc(node.from + 1, node.to - 1);
        const isActive = from >= node.from && to <= node.to;
        if (!isActive) {
          builder.add(
            node.from,
            node.to,
            Decoration.replace({
              widget: new MathInlineWidget(mathContent),
            }),
          );
        }
      }
    },
  });

  return builder.finish();
}

function toggleVisibility(view) {
  view.dispatch({
    effects: toggleMathBLockVisibilityEffect.of(
      createFrontmatterDecorations(view),
    ),
  });
}

class MathBlockWidget extends WidgetType {
  constructor(private mathContent: string) {
    super();
  }

  toDOM() {
    const math = document.createElement("div");
    katex.render(this.mathContent, math, {
      throwOnError: false,
      displayMode: true,
    });
    return math;
  }
}

class MathInlineWidget extends WidgetType {
  constructor(private mathContent: string) {
    super();
  }

  toDOM() {
    const math = document.createElement("span");
    katex.render(this.mathContent, math, {
      throwOnError: false,
      displayMode: false,
    });
    return math;
  }
}

export const MathBlockExtension = [
  mathBlockVisibilityField,
  EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet) {
      toggleVisibility(update.view);
    }
  }),
];
