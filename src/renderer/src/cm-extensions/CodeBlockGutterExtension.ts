import { gutter, GutterMarker, EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { SyntaxNodeRef } from "@lezer/common";

class LineNumberMarker extends GutterMarker {
  constructor(private number: number) {
    super();
  }
  toDOM() {
    return document.createTextNode(this.number.toString());
  }
}

const getCodeBlockLines = (node: SyntaxNodeRef, view: EditorView): number[] => {
  let lineStarts: number[] = [];
  let docStateLines = view.state.doc.slice(node.from, node.to).iterLines();
  let pos = node.from;

  for (let line of docStateLines) {
    lineStarts.push(pos);
    pos += line.length + 1;
  }
  return lineStarts.slice(1, -1);
};

const codeBlockGutter = gutter({
  lineMarker(view, line) {
    let currentBlock: number[] = [];

    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (node.name === "FencedCode") {
          const lines = getCodeBlockLines(node, view);
          if (lines.includes(line.from)) {
            currentBlock = lines;
          }
        }
      },
    });

    if (currentBlock) {
      let index = currentBlock.indexOf(line.from);
      if (index !== -1) {
        return new LineNumberMarker(index + 1);
      }
    }

    return null;
  },
  class: "cm-codeblock-line-number",
});

export const CodeBlockGutterExtension = [codeBlockGutter];
