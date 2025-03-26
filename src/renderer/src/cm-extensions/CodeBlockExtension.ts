import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { SyntaxNodeRef } from '@lezer/common';
import { RangeSetBuilder } from '@uiw/react-codemirror';


const inlineCodeFormattingClasses = {
  InlineCodeText: 'cm-formatting-inline-code-text',
  InlineCodeMarker: 'cm-formatting-inline-code-marker',
}

const markDecorationClass = Decoration.mark({ class: 'cm-inline-code-marker' })
const codeDecorationClass = Decoration.mark({ class: 'cm-inline-code-text' })

/**
 * Get the start positions of each line in a block syntax node (FencedCode)
 * @param {SyntaxNodeRef} node The block node 
 * @param {EditorView} view The EditorView
 * @returns {Array<number>} An array of line start positions
*/
function getLineStartPositions(node: SyntaxNodeRef, view: EditorView) {
  let lineStarts: Array<number> = []
  let docStateLines = view.state.doc.slice(node.from, node.to).iterLines()
  let starts = node.from
  
  for (let line of docStateLines) {
    starts += line.length + 1
    lineStarts.push(starts)
  }
  lineStarts.pop()
  return lineStarts
}

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
              const isActive = from >= node.from && to <= node.to;
              const lineStarts = getLineStartPositions(node, view)
              
              builder.add(node.from, node.from, Decoration.line({ class: `cm-formatting-codeblock-line-begin active`}))

              if (!isActive) {
                builder.add(node.from, lineStarts[0] - 1, Decoration.widget({
                  widget: new CodeLanguageIndicatorWidget(view.state.sliceDoc(node.from + 3, lineStarts[0] - 1)),
                }))
              } 
              
              for (let i = 0; i < lineStarts.length - 1; i++) {
                builder.add(lineStarts[i], lineStarts[i], Decoration.line({ class: 'cm-formatting-codeblock-line'}))
              }
              builder.add(lineStarts[lineStarts.length - 1], lineStarts[lineStarts.length - 1], 
                Decoration.line({ class: `cm-formatting-codeblock-line-end ${isActive ? 'active' : ''}`}))
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

class CodeLanguageIndicatorWidget extends WidgetType {
  constructor(private language: string) {
      super();
      this.language = language;
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'cm-formatting-codeblock-language-container';
    container.style.float = 'right';
    
    const span = document.createElement('span');
    span.textContent = this.language;
    span.className = 'cm-formatting-codeblock-language';
    
    container.appendChild(span);
    return container;
  }
}

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