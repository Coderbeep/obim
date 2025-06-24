import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@uiw/react-codemirror";

// TODO: Ability to change to bullet type
// TODO: bug in indentation guide when mixing unordered and ordered lists
// TODO: ability to start with the ordered list and then insert bullets
//       - probably because of wrong indentation levels (add level to stack if start with bullets)

// consider the StateCommand deleteGroupBackward being used to delete the list mark

const TAB_SIZE = 4;

interface ListElement {
  startPos: number;
  indentLevel: number;
  indentRanges: Array<{ from: number; to: number }>;
  isBullet: boolean;
  mixedList: boolean;
}

function getLineIndentRanges(
  line: string,
  startingPosition: number,
): Array<{ from: number; to: number }> {
  let indentLength = line.match(/^\s*/)?.[0]?.length ?? 0;
  let indentRanges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < indentLength / TAB_SIZE; ++i) {
    indentRanges.push({
      from: startingPosition + i * TAB_SIZE,
      to: startingPosition + i * TAB_SIZE + TAB_SIZE,
    });
  }
  return indentRanges;
}

function isBulletListLine(line: string): boolean {
  return line.trim().startsWith("-");
}

function isOrderedListLine(line: string): boolean {
  return line.trim().match(/^\d+/) !== null;
}

export const ListsExtension = ViewPlugin.fromClass(
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

    computeDecorations(view: EditorView) {
      const builder = new RangeSetBuilder();

      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (node.name === "BulletList" && node.matchContext(["Document"])) {
            const listElements: Array<ListElement> = [];
            const lines = view.state.doc.slice(node.from, node.to).iterLines();
            let starts = node.from;

            for (let line of lines) {
              let indentLevel =
                (line.match(/^\s*/)?.[0]?.length ?? 0) / TAB_SIZE + 1;
              listElements.push({
                startPos: starts,
                indentLevel: indentLevel,
                indentRanges: getLineIndentRanges(line, starts),
                isBullet: isBulletListLine(line),
                mixedList: isOrderedListLine(line),
              });
              starts += line.length + 1;
            }

            listElements.forEach((elem) => {
              const lineClass = elem.mixedList
                ? `cm-listB-line-level-${elem.indentLevel}`
                : elem.isBullet
                  ? `cm-listA-line-level-${elem.indentLevel}`
                  : `cm-listA-line-noBullet-level-${elem.indentLevel}`;

              builder.add(
                elem.startPos,
                elem.startPos,
                Decoration.line({ class: lineClass }),
              );
              elem.indentRanges.forEach((indent) => {
                builder.add(
                  indent.from,
                  indent.to,
                  Decoration.mark({ class: `cm-listA-indent` }),
                );
              });
            });
          }

          if (node.name === "OrderedList" && node.matchContext(["Document"])) {
            const listElements: Array<ListElement> = [];
            const lines = view.state.doc.slice(node.from, node.to).iterLines();
            let starts = node.from;

            for (let line of lines) {
              let indentLevel =
                (line.match(/^\s*/)?.[0]?.length ?? 0) / TAB_SIZE + 1;
              listElements.push({
                startPos: starts,
                indentLevel: indentLevel,
                indentRanges: getLineIndentRanges(line, starts),
                isBullet: isOrderedListLine(line),
                mixedList: isBulletListLine(line),
              });
              starts += line.length + 1;
            }

            listElements.forEach((elem) => {
              const lineClass = elem.mixedList
                ? `cm-lista-line-level-${elem.indentLevel}`
                : elem.isBullet
                  ? `cm-listB-line-level-${elem.indentLevel}`
                  : `cm-listB-line-noBullet-level-${elem.indentLevel}`;

              builder.add(
                elem.startPos,
                elem.startPos,
                Decoration.line({ class: lineClass }),
              );
              elem.indentRanges.forEach((indent) => {
                builder.add(
                  indent.from,
                  indent.to,
                  Decoration.mark({ class: `cm-listB-indent` }),
                );
              });
            });
          }
        },
      });
      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
