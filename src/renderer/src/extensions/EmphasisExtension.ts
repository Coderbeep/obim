import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@uiw/react-codemirror';

// TODO: Click on the widget should insert the selection at the heading position

// TODO: rename variables for italic support

const italicFormattingClasses = {
  ItalicText: 'cm-formatting-italic-text',
  ItalicMarker: 'cm-formatting-italic-marker',
}

const boldFormattingClasses = {
  BoldText: 'cm-formatting-bold-text',
  BoldMarker: 'cm-formatting-bold-marker',
}

const italicMarkDecorationClass = Decoration.mark({ class: 'cm-italic-marker' })
const italicTextDecorationClass = Decoration.mark({ class: 'cm-italic-text' })

const BoldMarkDecorationClass = Decoration.mark({ class: 'cm-bold-marker' })
const BoldTextDecorationClass = Decoration.mark({ class: 'cm-bold-text' })


export const EmphasisExtension = ViewPlugin.fromClass(class {
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
      const builder = new RangeSetBuilder();
      const { from, to } = view.state.selection.main;

      syntaxTree(view.state).iterate({
          enter: (node) => {
            if (node.name === 'Emphasis') { 
              console.log(node.from, node.to, view.state.sliceDoc(node.from, node.to))   
              const isActive = from >= node.from && to <= node.to;
              if (!isActive) {
                builder.add(node.from, node.from + 1, Decoration.widget({
                  widget: new MarkerWidget(),
                  side: 1,
                }))
                builder.add(node.from + 1, node.to - 1, Decoration.mark(Decoration.mark({ class:  italicFormattingClasses.ItalicText})))
                builder.add(node.to - 1, node.to, Decoration.widget({
                  widget: new MarkerWidget(),
                  side: 1,
                }))
              }
              else {
                builder.add(node.from, node.from + 1, italicMarkDecorationClass)
                builder.add(node.from + 1, node.to - 1, italicTextDecorationClass)
                builder.add(node.to - 1, node.to, italicMarkDecorationClass)
              }
            }
            if (node.name === 'StrongEmphasis') {    
              const isActive = from >= node.from && to <= node.to;
              if (!isActive) {
                builder.add(node.from, node.from + 2, Decoration.widget({
                  widget: new MarkerWidget(),
                  side: 1,
                }))
  
  
                builder.add(node.from + 2, node.to - 2, Decoration.mark(Decoration.mark({ class:  boldFormattingClasses.BoldText})))
  
  
                builder.add(node.to - 2, node.to, Decoration.widget({
                  widget: new MarkerWidget(),
                  side: 1,
                }))
              }
              else {
                builder.add(node.from, node.from + 2, BoldMarkDecorationClass)
                builder.add(node.from + 2, node.to - 2, BoldTextDecorationClass)
                builder.add(node.to - 2, node.to, BoldMarkDecorationClass)
              }
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

class MarkerWidget extends WidgetType {
  constructor() {
      super();
  }
  toDOM() {
      const span = document.createElement('span');
      span.textContent = ''
      return span;
  }
}