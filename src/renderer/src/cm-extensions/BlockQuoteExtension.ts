import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { Range } from '@codemirror/state';

const tokenFormattingClasses = {
  'Blockquote': (isActive: boolean) => { return isActive ? 
    Decoration.mark({ class: 'cm-formatting-blockquote cm-active' }) : 
    Decoration.mark({ class: 'cm-formatting-blockquote' })},
  'QuoteMark': Decoration.mark({ class: 'cm-formatting-quote-mark' }),
}

const tokenElements = [
  'Blockquote',
  'QuoteMark',
]

export const BlockQuoteExtension = ViewPlugin.fromClass(class {
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
      let widgets: Range<Decoration>[] = []
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
          enter: (node) => {
            if (tokenElements.includes(node.name)) {
              const isActive = from <= node.to && to >= node.from;
              if (node.name === 'Blockquote') {
                widgets.push(tokenFormattingClasses[node.name](isActive).range(node.from, node.to))
              } else {
                widgets.push(tokenFormattingClasses[node.name].range(node.from, node.to))
              }
            }
          }
      });

      return Decoration.set(widgets);
  }
}, {
  decorations: v => v.decorations
});