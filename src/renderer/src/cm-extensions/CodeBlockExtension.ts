import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@uiw/react-codemirror';


const inlineCodeFormattingClasses = {
  InlineCodeText: 'cm-formatting-inline-code-text',
  InlineCodeMarker: 'cm-formatting-inline-code-marker',
}

const markDecorationClass = Decoration.mark({ class: 'cm-inline-code-marker' })
const codeDecorationClass = Decoration.mark({ class: 'cm-inline-code-text' })

export const CodeBlockExtension = ViewPlugin.fromClass(class {
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
      const { from, to } = view.state.selection.main;


      syntaxTree(view.state).iterate({
          enter: (node) => {
            if (node.name === 'InlineCode') {    
              const isActive = from >= node.from && to <= node.to;
              if (!isActive) {
                builder.add(node.from, node.from + 1, Decoration.widget({
                  widget: new InlineCodeMarkerWidget(),
                  side: 1,
                }))
  
  
                builder.add(node.from + 1, node.to - 1, Decoration.mark(Decoration.mark({ class:  inlineCodeFormattingClasses.InlineCodeText})))
  
  
                builder.add(node.to - 1, node.to, Decoration.widget({
                  widget: new InlineCodeMarkerWidget(),
                  side: 1,
                }))
              }
              else {
                builder.add(node.from, node.from + 1, markDecorationClass)
                builder.add(node.from + 1, node.to - 1, codeDecorationClass)
                builder.add(node.to - 1, node.to, markDecorationClass)
              }
            }
            
            if (node.name === 'FencedCode') {
              let lineStarts = []
              let docStateLines = view.state.doc.slice(node.from, node.to).iterLines()
              let starts = node.from
              
              for (let line of docStateLines) {
                starts += line.length + 1
                lineStarts.push(starts)
              }
              lineStarts.pop()

              builder.add(node.from, node.from, Decoration.line({ class: 'cm-formatting-codeblock-line-begin'}))
              for (let i = 0; i < lineStarts.length - 1; i++) {
                builder.add(lineStarts[i], lineStarts[i], Decoration.line({ class: 'cm-formatting-codeblock-line'}))
              }
              builder.add(lineStarts[lineStarts.length - 1], lineStarts[lineStarts.length - 1], Decoration.line({ class: 'cm-formatting-codeblock-line-end'}))
            }
          }
      });

      return builder.finish();
  }

  get decorationss() {
      return this.decorations;
  }
}, {
  decorations: v => v.decorations
});

class InlineCodeMarkerWidget extends WidgetType {
  constructor() {
      super();
  }

  toDOM() {
      const span = document.createElement('span');
      span.textContent = ''
      span.className = inlineCodeFormattingClasses.InlineCodeMarker;
      return span;
  }
}