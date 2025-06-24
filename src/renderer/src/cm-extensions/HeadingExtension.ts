import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Range } from "@codemirror/state";

// TODO: Click on the widget should insert the selection at the heading position
// TODO: bottom border for the widget container

const tokenFormattingClasses = {
  HeadingMarkHidden: Decoration.mark({ class: "cm-mark-hidden" }),
  HeadingMark: Decoration.mark({ class: "cm-formatting-heading-mark" }),
  headings: {
    1: Decoration.mark({ class: "cm-formatting-heading-1" }),
    2: Decoration.mark({ class: "cm-formatting-heading-2" }),
    3: Decoration.mark({ class: "cm-formatting-heading-3" }),
    4: Decoration.mark({ class: "cm-formatting-heading-4" }),
    5: Decoration.mark({ class: "cm-formatting-heading-5" }),
    6: Decoration.mark({ class: "cm-formatting-heading-6" }),
  },
};

const headingLevels = {
  ATXHeading1: 1,
  ATXHeading2: 2,
  ATXHeading3: 3,
  ATXHeading4: 4,
  ATXHeading5: 5,
  ATXHeading6: 6,
};

export const HeadingExtension = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view) {
      this.decorations = this.computeDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = this.computeDecorations(update.view);
      }
    }

    computeDecorations(view) {
      const widgets: Range<Decoration>[] = [];
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (node.name === "HeaderMark") {
            widgets.push(
              tokenFormattingClasses.HeadingMarkHidden.range(
                node.from,
                node.to + 1,
              ),
            );
          }

          if (headingLevels[node.name]) {
            const level = headingLevels[node.name];
            const isActive = from <= node.to && to >= node.from;
            widgets.push(
              tokenFormattingClasses.headings[level].range(node.from, node.to),
            );
            widgets.push(
              tokenFormattingClasses.HeadingMark.range(
                node.from,
                node.from + level,
              ),
            );
            if (isActive) {
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
