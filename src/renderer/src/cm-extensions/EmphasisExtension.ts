import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin } from "@codemirror/view";
import type { Range } from "@codemirror/state";

const tokenFormattingClasses = {
  StrongEmphasis: Decoration.mark({ class: "cm-formatting-bold-text" }),
  Emphasis: Decoration.mark({ class: "cm-formatting-italic-text" }),
};

const tokenElements = ["StrongEmphasis", "Emphasis"];

const tokenHiddenElements = ["EmphasisMark"];

export const EmphasisExtension = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view) {
      this.decorations = this.computeDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view) {
      let widgets: Range<Decoration>[] = [];
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (tokenHiddenElements.includes(node.name)) {
            widgets.push(
              Decoration.mark({ class: "cm-mark-hidden" }).range(
                node.from,
                node.to,
              ),
            );
          }

          if (tokenElements.includes(node.name)) {
            widgets.push(
              tokenFormattingClasses[node.name].range(node.from, node.to),
            );
            if (from <= node.to && to >= node.from) {
              return false;
            }
          }
        },
      });
      return Decoration.set(widgets);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
